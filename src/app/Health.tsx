import { existsSync, readFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { useEffect, useState } from "react"
import type { HarnessAdapter, HarnessId, Item, McpServer, Roots, WritePlan } from "../core/model"
import { HARNESS_LABELS } from "../core/model"
import { listItems, literalSecrets } from "../core/registry"
import { emptyPlan } from "../core/memory-plan"
import { FRONTMATTER_PATTERN, parseEntryFrontmatter } from "../memory/entry"
import { truncate } from "../memory/format"
import { healthIssues, type Issue } from "../memory/issues"
import { editItem, type FlowContext, runMcpAction, type Screen } from "./flows"
import { tildePath } from "./ItemList"
import { DIM, SELECTED_BG, theme } from "./theme"

const KIND_WIDTH = 15 // "dead-index" is the longest kind
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

interface HealthProps {
  issues: Issue[]
  selected: number
  layout: { home: string; width: number }
}

export function Health({ issues, selected, layout }: HealthProps) {
  if (issues.length === 0) return <text fg={DIM}> No issues.</text>
  return (
    <box flexDirection="column" paddingLeft={1}>
      <text fg={DIM} wrapMode="none">{truncate("Fix repairs the file. Unlink turns [[x]] into plain text.", layout.width)}</text>
      {issues.map((issue, index) => (
        <text key={`${issue.kind}\0${issue.path}\0${issue.detail}`} wrapMode="none" fg={index === selected ? theme.selFg : undefined} bg={index === selected ? SELECTED_BG : undefined}>
          {truncate(issueRow(issue, index === selected, layout.home), layout.width)}
        </text>
      ))}
    </box>
  )
}

function issueRow(issue: Issue, selected: boolean, home: string): string {
  return `${selected ? "▸ " : "  "}▲ ${issue.kind.padEnd(KIND_WIDTH)}${issue.detail}  ${tildePath(issue.path, home)}`
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
