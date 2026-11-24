import { existsSync, readFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { useEffect, useState } from "react"
import type { HarnessAdapter, HarnessId, Item, McpServer, Roots, WritePlan } from "../core/model"
import { HARNESS_LABELS } from "../core/model"
import { listItems, literalSecrets } from "../core/registry"
import { emptyPlan } from "../core/memory-plan"
import { FRONTMATTER_PATTERN, parseEntryFrontmatter } from "../memory/entry"
import { pad, shortPath } from "../memory/format"
import { healthIssues, type Issue } from "../memory/issues"
import { editItem, type FlowContext, runMcpAction, type Screen } from "./flows"
import { tildePath } from "./ItemList"
import { ScrollList } from "./ScrollList"
import { ACCENT, DIM, SELECTED_BG, theme } from "./theme"

const LINK_PATTERN = /\[\[([^\]]+)\]\]/g
const CODE_SEGMENT = /(```[\s\S]*?```|`[^`]*`)/

// The Health checks read disk, so they run once per reload rather than on every render.
export function useIssues(adapters: HarnessAdapter[], roots: Roots, reloads: number): Issue[] {
  const [issues, setIssues] = useState<Issue[]>([])
  useEffect(() => {
    let live = true
    healthIssues(adapters, roots).then(
      (found) => live && setIssues(found),
      () => live && setIssues([]),
    )
    return () => {
      live = false
    }
  }, [adapters, roots, reloads])
  return issues
}

interface IssueText {
  group: "secrets" | "memory" | "skills"
  title: string // the detail strip title
  key: string // the fixing key hint
  sentence: (issue: Issue) => string
  fix: string // what the key does
}

const fileName = (issue: Issue) => basename(issue.path)
const ISSUE_TEXT: Record<Issue["kind"], IssueText> = {
  "mcp-secret": { group: "secrets", title: "Secret in config", key: "f fix", sentence: (issue) => `${issue.detail.split(" ")[0]} holds a literal value`, fix: "f replaces it with ${NAME}, which the harness reads from your environment." },
  "broken-link": { group: "memory", title: "Broken link", key: "r unlink", sentence: (issue) => `${issue.detail.match(/^\[\[.+?\]\]/)?.[0] ?? issue.detail} links to no entry`, fix: "r turns the link into plain text." },
  orphan: { group: "memory", title: "Not in MEMORY.md", key: "f add", sentence: (issue) => `${fileName(issue).replace(/\.md$/, "")} is missing from MEMORY.md`, fix: "f adds its line at the top of MEMORY.md, so it loads at start." },
  "dead-index": { group: "memory", title: "Dead index line", key: "f drop", sentence: (issue) => `MEMORY.md ${issue.detail.match(/^line \d+/)?.[0] ?? "a line"} points to a missing file`, fix: "f drops that line from MEMORY.md." },
  "past-limit": { group: "memory", title: "Past the load limit", key: "e edit", sentence: (issue) => `${fileName(issue)} is past the MEMORY.md load limit`, fix: "e opens the file so you can shorten the index." },
  "bad-frontmatter": { group: "memory", title: "Bad header", key: "e edit", sentence: (issue) => `${fileName(issue)} has a header that is not valid YAML`, fix: "e opens the file so you can repair its header." },
  "over-budget": { group: "memory", title: "Over budget", key: "e edit", sentence: (issue) => `${fileName(issue)} is over its line budget`, fix: "e opens the file so you can shorten it." },
  skill: { group: "skills", title: "Skill check", key: "e edit", sentence: (issue) => issue.detail.charAt(0).toUpperCase() + issue.detail.slice(1), fix: "e opens SKILL.md so you can fix it." },
}

const GROUPS: { id: IssueText["group"]; label: string; color: string }[] = [
  { id: "secrets", label: "SECRETS IN CONFIG", color: theme.err },
  { id: "memory", label: "AUTO MEMORY", color: theme.warn },
  { id: "skills", label: "SKILLS", color: theme.warn },
]

// Secrets first, then auto memory, then skills: the order the rows show and the keys act on.
export function orderIssues(issues: Issue[]): Issue[] {
  return GROUPS.flatMap((group) => issues.filter((issue) => ISSUE_TEXT[issue.kind].group === group.id))
}

export const issueId = (issue: Issue) => `${issue.kind}\0${issue.path}\0${issue.detail}`

// "3 secrets · 7 warnings" for the key bar.
export function issueSummary(issues: Issue[]): string {
  const secrets = issues.filter((issue) => issue.kind === "mcp-secret").length
  return `${secrets} secret${secrets === 1 ? "" : "s"} · ${issues.length - secrets} warning${issues.length - secrets === 1 ? "" : "s"}`
}

interface HealthProps {
  issues: Issue[] // in orderIssues order
  selectedId: string | undefined
  layout: { home: string; width: number }
}

export function Health({ issues, selectedId, layout }: HealthProps) {
  if (issues.length === 0) return <text fg={DIM}> No issues.</text>
  const rows = GROUPS.flatMap((group) => {
    const found = issues.filter((issue) => ISSUE_TEXT[issue.kind].group === group.id)
    if (found.length === 0) return []
    const head = { id: `group\0${group.id}`, node: <IssueGroupRow label={group.label} color={group.color} count={found.length} width={layout.width} /> }
    return [head, ...found.map((issue) => ({ id: issueId(issue), node: <IssueRow issue={issue} selected={issueId(issue) === selectedId} layout={layout} /> }))]
  })
  return <ScrollList rows={rows} selectedId={selectedId} />
}

function IssueGroupRow({ label, color, count, width }: { label: string; color: string; count: number; width: number }) {
  return (
    <text wrapMode="none">
      <span fg={color}><b>{` ${label} `}</b></span>
      <span fg={theme.faint}>{"─".repeat(Math.max(1, width - label.length - String(count).length - 4))}</span>
      <span fg={DIM}>{` ${count} `}</span>
    </text>
  )
}

const SENTENCE_WIDTH = 50
const PLACE_WIDTH = 28
const KEY_WIDTH = 10 // "r unlink" and its gap

function IssueRow({ issue, selected, layout }: { issue: Issue; selected: boolean; layout: HealthProps["layout"] }) {
  const text = ISSUE_TEXT[issue.kind]
  // The sentence gives up room first, so the fixing key always shows.
  const sentenceWidth = Math.max(10, Math.min(SENTENCE_WIDTH, layout.width - PLACE_WIDTH - KEY_WIDTH))
  const room = Math.max(0, layout.width - sentenceWidth - PLACE_WIDTH - 2)
  return (
    <box width={layout.width} flexDirection="row" backgroundColor={selected ? SELECTED_BG : undefined}>
      <text wrapMode="none">
        <span fg={ACCENT}>{selected ? "▌" : " "}</span>
        {` ${pad(text.sentence(issue), sentenceWidth)}`}
        <span fg={DIM}>{pad(issuePlace(issue, layout.home), PLACE_WIDTH)}</span>
        <span fg={ACCENT}>{text.key.slice(0, room)}</span>
      </text>
    </box>
  )
}

// A short location: the file for memory issues, the folder for skills, the config file for secrets.
function issuePlace(issue: Issue, home: string): string {
  if (issue.kind === "dead-index") return `MEMORY.md · ${issue.detail.match(/missing (.+)$/)?.[1] ?? ""}`
  if (issue.kind === "skill") return shortPath(tildePath(dirname(issue.path), home), PLACE_WIDTH - 1)
  if (issue.kind === "mcp-secret") return shortPath(tildePath(issue.path, home), PLACE_WIDTH - 1)
  return basename(issue.path)
}

// The detail strip for the selected issue: what is wrong, what the fix does, and that nothing is written unreviewed.
export function IssueDetail({ issue, home }: { issue: Issue | undefined; home: string }) {
  if (!issue) return <text fg={DIM} wrapMode="none"> Nothing to fix.</text>
  const text = ISSUE_TEXT[issue.kind]
  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <text wrapMode="none"><span fg={ACCENT}><b>{text.title}</b></span><span fg={DIM}>{`  ${text.sentence(issue)}.`}</span></text>
      <text wrapMode="none">{`${text.fix} You review it first.`}</text>
      <text fg={theme.faint} wrapMode="none">{tildePath(issue.path, home)}</text>
    </box>
  )
}

interface IssueAction {
  issue: Issue
  items: Item[] // the Memory listing, which holds the memory files and the MCP items' files
  context: FlowContext
}

// f, r and e on the highlighted issue; undefined when the key is not an action.
export function runIssueAction(name: string, action: IssueAction | undefined): Screen | Promise<Screen | void> | undefined {
  if (!action) return undefined
  if (name === "e") return editIssue(action)
  if (name === "f") return fixIssue(action)
  if (name === "r") return unlinkIssue(action)
  return undefined
}

// An MCP secret opens that server's form; every other issue opens the file's text editor.
async function editIssue({ issue, items, context }: IssueAction): Promise<Screen | void> {
  if (issue.kind !== "mcp-secret") return editItem(itemFor(issue, items), context)
  const server = (await listItems(context.adapters, "mcp", context.roots)).find((item) => item.path === issue.path)
  return server ? runMcpAction("e", server, context) : context.notify(`${issue.path} no longer holds an MCP server.`, true)
}

// The harness's own file for the issue: the listed memory or skill item, else a Claude Code auto memory entry.
function itemFor(issue: Issue, items: Item[]): Item {
  const listed = items.find((item) => item.path === issue.path)
  if (listed) return listed
  if (issue.kind === "skill") {
    const folder = dirname(issue.path)
    return { kind: "skill", harness: harnessOf(issue), scope: "global", name: basename(folder), path: folder, loadedBy: [harnessOf(issue)] }
  }
  return { kind: "memory", harness: "claude-code", scope: "project", name: basename(issue.path), path: issue.path, loadedBy: ["claude-code"] }
}

// The harness a skill issue names, from its "<Harness>: <check>" detail.
function harnessOf(issue: Issue): HarnessId {
  const label = issue.detail.slice(0, issue.detail.indexOf(":"))
  return (Object.keys(HARNESS_LABELS) as HarnessId[]).find((id) => HARNESS_LABELS[id] === label) ?? "claude-code"
}

function fixIssue({ issue, context }: IssueAction): Promise<void> | undefined {
  if (issue.kind === "orphan") return reviewEdit(indexPath(issue), addLine(fileText(indexPath(issue)), indexLine(issue)), context)
  if (issue.kind === "dead-index") return reviewEdit(issue.path, dropLine(fileText(issue.path), indexLineNumber(issue)), context)
  if (issue.kind === "mcp-secret") return replaceSecret(issue, context)
  if (issue.kind === "skill") context.notify("Edit SKILL.md to fix this.")
  return undefined
}

function unlinkIssue({ issue, context }: IssueAction): undefined {
  if (issue.kind !== "broken-link") return undefined
  const target = issue.detail.match(/^\[\[(.+?)\]\]/)?.[1]
  if (!target) return undefined
  reviewEdit(issue.path, unlink(fileText(issue.path), target), context)
  return undefined
}

// A memory fix is one file edit, so a MEMORY.md that is not there yet needs no plan from a harness.
function reviewEdit(path: string, after: string, context: FlowContext): undefined {
  const before = existsSync(path) ? fileText(path) : null
  const plan: WritePlan = { ...emptyPlan(), edits: [{ path, before, after }] }
  context.open({ name: "review", plan, secrets: [] })
  return undefined
}

// An orphan gets its line at the top of MEMORY.md, as a new entry does.
function indexLine(issue: Issue): string {
  const block = fileText(issue.path).match(FRONTMATTER_PATTERN)?.[1] ?? ""
  const { meta } = parseEntryFrontmatter(block)
  const file = basename(issue.path)
  const title = typeof meta.name === "string" ? meta.name : file.replace(/\.md$/, "")
  return `- [${title}](${file})${typeof meta.description === "string" ? ` — ${meta.description}` : ""}`
}

const indexPath = (issue: Issue) => join(dirname(issue.path), "MEMORY.md")
const addLine = (text: string, line: string) => (text === "" ? line : `${line}\n${text}`)
const indexLineNumber = (issue: Issue) => Number(issue.detail.match(/^line (\d+) /)?.[1])

function dropLine(text: string, line: number): string {
  if (!line) return text
  const lines = text.split("\n")
  return [...lines.slice(0, line - 1), ...lines.slice(line)].join("\n")
}

// The body keeps its frontmatter and code spans; only the plain [[link]] becomes the bare target.
function unlink(text: string, target: string): string {
  const head = text.match(FRONTMATTER_PATTERN)?.[0] ?? ""
  const swap = (part: string) => part.replace(LINK_PATTERN, (match, inner: string) => (inner.trim() === target ? target : match))
  return head + text.slice(head.length).split(CODE_SEGMENT).map((part, index) => (index % 2 ? part : swap(part))).join("")
}

// A literal secret becomes ${NAME}, which every harness reads from the environment.
async function replaceSecret(issue: Issue, context: FlowContext): Promise<void> {
  const name = issue.detail.split(" ")[0]!
  const servers = (await listItems(context.adapters, "mcp", context.roots)).filter((item) => item.path === issue.path)
  for (const item of servers) {
    const detail = await context.adapters.find((adapter) => adapter.id === item.harness)?.read(item)
    if (detail?.type !== "mcp") continue
    const fixed = withEnvRef(detail.server, name)
    if (!fixed) continue
    context.review({ kind: "mcp", op: "update", target: { harness: item.harness, scope: item.scope }, item, server: fixed })
    return
  }
  context.notify(`${name} is no longer a literal value in ${issue.path}.`, true)
}

// The server with the named literal value replaced, or null when it holds no such value.
function withEnvRef(server: McpServer, name: string): McpServer | null {
  const literal = new Set(literalSecrets(server))
  const ref = (values: Record<string, string> | undefined) =>
    values && literal.has(values[name] ?? "") ? { ...values, [name]: `\${${name}}` } : values
  const env = ref(server.env)
  const headers = ref(server.headers)
  return env === server.env && headers === server.headers ? null : { ...server, env, headers }
}

// Empty text for a file that is not there, so a missing index reads as empty rather than absent.
function fileText(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : ""
}
