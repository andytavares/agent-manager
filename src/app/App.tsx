import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { useEffect, useMemo, useReducer, useRef, useState, type MutableRefObject, type ReactNode } from "react"
import { basename, dirname } from "node:path"
import type { Issue } from "../memory/issues"
import { defaultBackupRoot } from "../core/apply"
import { undoLast } from "../core/undo"
import { HARNESS_LABELS, type HarnessAdapter, type HarnessId, type Item, type Kind, type McpServer, type ProjectData, type Roots } from "../core/model"
import { listItems, literalSecrets, mergePlans, planChange } from "../core/registry"
import { shortPath } from "../memory/format"
import { DetailPane } from "./DetailPane"
import { Dialog } from "./Dialog"
import { useEntries } from "./entries"
import { Health, IssueDetail, issueId, issueSummary, orderIssues, runIssueAction, useIssues } from "./Health"
import { addMarketplace, addMemory, deleteItem, deleteProjects, editItem, type FlowContext, type Marketplace, marketplaceList, newSkill, projectList, relocateSkill, removeMarketplace, runMcpAction, runPluginAction, type Screen } from "./flows"
import { countText, ItemList, listGroups, type ListGroup, type ReadFacts, SHORT_CODES, tildePath } from "./ItemList"
import { KeyBar, type KeyHint } from "./KeyBar"
import { Marketplaces } from "./Marketplaces"
import { McpForm, type McpTarget } from "./McpForm"
import { Projects } from "./Projects"
import { Prompt } from "./Prompt"
import { ReviewChanges } from "./ReviewChanges"
import { ACCENT, DIM, SELECTED_BG, theme } from "./theme"
import { TextEditor } from "./TextEditor"
import { useUsage } from "./usage"

type Focus = "agents" | "list"
type ListScreen = "list" | "projects" | "marketplaces" // where back and apply return to
type Tab = Kind | "health"

const KIND_KEYS: Record<string, Tab> = { "1": "memory", "2": "skill", "3": "mcp", "4": "plugin", "5": "health" }
const TAB_NAMES = ["1 Memory", "2 Skills", "3 MCP", "4 Plugins", "5 Health"]
const LIST: Screen = { name: "list" }
const NO_MESSAGE = { text: "", error: false }
const NO_FILTER = { text: "", active: false }
const SHELL_KEYS: KeyHint[] = [["/", "filter"], ["u", "undo"], ["?", "all keys"]]
const SCREEN_KEYS: Record<string, KeyHint[]> = {
  memory: [["a", "add"], ["e", "edit"], ["d", "delete"]],
  skill: [["a", "new"], ["⏎", "edit SKILL.md"], ["c", "copy to"], ["m", "move to"], ["d", "delete"]],
  mcp: [["a", "add"], ["e", "edit"], ["c", "copy to"], ["space", "turn on/off"], ["d", "delete"]],
  plugin: [["i", "install"], ["space", "turn on/off"], ["U", "update"], ["x", "uninstall"], ["m", "marketplaces"]],
  health: [["f", "fix"], ["r", "unlink"], ["e", "edit file"]],
  prompt: [["↑↓", "choose"], ["⏎", "next"], ["esc", "cancel"]],
  editor: [["ctrl+s", "review and save"], ["esc", "discard"]],
  mcpForm: [["tab", "next field"], ["space", "toggle"], ["←→", "change"], ["⏎", "review"], ["esc", "cancel"]],
  review: [["⏎", "apply"], ["esc", "back"], ["↑↓", "scroll"]],
  marketplaces: [["a", "add"], ["d", "remove"], ["esc", "back to plugins"]],
  projects: [["⏎", "open"], ["space", "mark"], ["d", "delete data"], ["esc", "keep current"]],
}

interface AppProps {
  adapters: HarnessAdapter[]
  roots: Roots
  backupRoot?: string
  onQuit: () => void
}

export function App({ adapters, roots: startRoots, backupRoot = defaultBackupRoot(startRoots), onQuit }: AppProps) {
  const [project, setProject] = useState(startRoots.project)
  const roots = useMemo(() => ({ ...startRoots, project }), [startRoots, project])
  const [view, dispatch] = useReducer(pressKey, START_VIEW)
  const [screen, setScreen] = useState<Screen>(LIST)
  const [returnTo, setReturnTo] = useState<ListScreen>("list")
  const show = (next: Screen) => {
    if (next.name === "list" || next.name === "projects" || next.name === "marketplaces") setReturnTo(next.name)
    setScreen(next)
  }
  const [message, setMessage] = useState(NO_MESSAGE)
  const [reloads, setReloads] = useState(0)
  const [filter, setFilterState] = useState(NO_FILTER)
  const filterNow = useRef(NO_FILTER) // keys can arrive faster than renders
  const setFilter = (next: typeof NO_FILTER) => {
    filterNow.current = next
    setFilterState(next)
  }
  const [showHelp, setShowHelp] = useState(false)
  const { width, height } = useTerminalDimensions()
  const renderer = useRenderer()
  const layout = shellLayout(width, height)
  const detected = useDetected(adapters, roots)
  const listing = useListing(adapters, roots, view.tab === "health" ? "memory" : view.tab, reloads)
  const usage = useUsage(listing.items, view.tab, roots)
  const entries = useEntries(roots, reloads)
  const issues = orderIssues(useIssues(adapters, roots, reloads))
  const { tab, focus, harnessIndex } = view
  const harness = adapters[harnessIndex - 1]
  const byHarness = harness ? listing.items.filter((item) => matchesHarness(item, harness.id)) : listing.items
  const healthItems = tab === "health" ? listing.items : [] // the Memory listing when the Health tab reads it
  const groups = listGroups({ kind: tab === "health" ? "memory" : tab, items: byHarness, entries, filter: filter.text, place: tildePath(roots.project, roots.home) })
  const rows = groups.flatMap((group) => group.rows)
  const selected = clamp(view.listIndex, rows.length - 1)
  const selectedRow = rows[selected]
  const selectedEntry = selectedRow?.entry
  const selectedItem = selectedRow?.item
  const issueIndex = clamp(view.listIndex, issues.length - 1)
  const selectedIssue = issues[issueIndex]
  const fail = (error: Error) => {
    setMessage({ text: error.message, error: true })
    show(LIST)
  }
  const start = (next: Screen | Promise<Screen | void>) => Promise.resolve(next).then((screen) => screen && show(screen), fail)
  const context: FlowContext = {
    adapters: adapters.filter((_, index) => detected[index]),
    roots,
    scope: selectedItem?.scope === "global" ? "global" : "project", // new entries land in the selected item's group; local files count as project
    review: (...changes) =>
      Promise.all(changes.map((change) => planChange(adapters, change, roots))).then((plans) => {
        setScreen({ name: "review", plan: mergePlans(plans), secrets: changes.flatMap((change) => literalSecrets(change.server)) })
      }, fail),
    open: show,
    back: () => (returnTo === "list" ? show(LIST) : start(returnTo === "projects" ? projectList(context) : marketplaceList(context))),
    notify: (text, error = false) => setMessage({ text, error }),
  }
  const openProject = (picked: ProjectData) => {
    if (!picked.path) return setMessage({ text: `Cannot open ${basename(picked.dataDir)}: its project folder is unknown.`, error: true })
    setProject(picked.path)
    show(LIST)
  }
  const onApplied = (text: string) => {
    setMessage({ text, error: false })
    context.back()
    setReloads((count) => count + 1)
  }
  const undo = () =>
    undoLast(dirname(backupRoot)).then(
      (text) => {
        setMessage({ text, error: false })
        setReloads((count) => count + 1)
      },
      (error: Error) => setMessage({ text: error.message, error: true }),
    )
  // The shell keys come first; an action key that they do not handle goes to the list.
  const shellKeys = {
    filterNow, // read live: a key can arrive before the filter's render
    setFilter,
    openHelp: () => setShowHelp(true),
    undo,
    onQuit,
  }
  // App registers its key handler before any screen mounts, so it runs first and can stop a key from reaching the screen.
  useKeyboard((key) => {
    setMessage(NO_MESSAGE)
    if (helpKey(key, { open: showHelp, screen: screen.name, setOpen: setShowHelp, typing: isTyping(renderer.currentFocusedRenderable) })) return key.stopPropagation()
    if (screen.name !== "list") return
    if (handleShellKey(key, shellKeys)) return
    const name = key.shift && key.name.length === 1 ? key.name.toUpperCase() : key.name
    if (tab === "health") {
      if (!runHealthKey(name, { issue: selectedIssue, items: healthItems, context, start })) dispatch({ name, harnessCount: adapters.length, listLength: issues.length })
    }
    else if (!runAction(name, { kind: tab, item: selectedItem, context, start })) {
      dispatch({ name, harnessCount: adapters.length, listLength: rows.length })
      if (name === "p") start(projectList(context))
    }
  })

  const harnessLabel = harness?.label ?? "All harnesses"
  const listPanel = {
    title: panelTitle({ tab, groups, filter, issues: issues.length, plugins: listing.items }),
    width: width - layout.left,
    stripHeight: layout.strip,
    focused: focus === "list",
  }
  const list = tab === "health" ? (
    <Health issues={issues} selectedId={selectedIssue && issueId(selectedIssue)} layout={{ home: roots.home, width: layout.rowWidth }} />
  ) : listing.error ? (
    <text fg={theme.err}>{listing.error}</text>
  ) : (
    <ItemList kind={tab} groups={groups} selectedId={selectedRow?.id} width={layout.rowWidth} filter={filter.text} entriesDir={entries.dir} context={{ harnessIds: adapters.map((a) => a.id), home: roots.home, project: roots.project, usage, facts: listing.facts, checks: skillChecks(issues) }} />
  )
  const detail = tab === "health" ? (
    <IssueDetail issue={selectedIssue} home={roots.home} />
  ) : (
    <DetailPane item={selectedEntry ? undefined : selectedItem} entry={selectedEntry} siblings={entries.entries} adapter={adapters.find((a) => a.id === selectedItem?.harness)} home={roots.home} />
  )
  const keyGroups = showHelp ? [[["any key", "close"] as KeyHint]] : screenKeys(screen.name === "list" ? tab : screen.name)
  const keyRight = showHelp || screen.name !== "list" ? screenRight(screen.name) : tab === "health" ? issueSummary(issues) : `row ${selected + 1} of ${rows.length}`

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.bg}>
      <Header project={roots.project} home={roots.home} harness={harnessLabel} wide={layout.left > 0} />
      <Tabs tab={tab} counts={tabCounts(adapters, roots, reloads)} issues={issues.length} />
      <text flexShrink={0} fg={theme.faint} wrapMode="none">{"─".repeat(width)}</text>
      <box flexDirection="row" flexGrow={1} flexShrink={1} overflow="hidden">
        {screen.name !== "list" ? (
          <ActiveScreen screen={screen} context={context} backupRoot={backupRoot} onApplied={onApplied} onOpenProject={openProject} />
        ) : (
          <>
            {layout.left > 0 && <LeftColumn harnesses={harnessRows(adapters, detected, listing.items)} selected={harnessIndex} focused={focus === "agents"} project={roots.project} home={roots.home} />}
            <ListPanel {...listPanel} list={list} detail={detail} />
          </>
        )}
      </box>
      {showHelp && (
        <box position="absolute" top={3} left={0} width={width} height={Math.max(1, height - 5)} zIndex={10} backgroundColor={theme.bg}>
          <Help width={Math.min(HELP_WIDTH, width - 4)} />
        </box>
      )}
      <text flexShrink={0} fg={message.error ? theme.err : theme.ok} wrapMode="none">{` ${message.text}`}</text>
      <KeyBar groups={keyGroups} width={width} right={keyRight} />
    </box>
  )
}

interface ViewState {
  tab: Tab
  focus: Focus
  harnessIndex: number // 0 = All, else adapters[harnessIndex - 1]
  listIndex: number
}

interface KeyPress {
  name: string
  harnessCount: number
  listLength: number
}

interface ActionTarget {
  kind: Kind
  item: Item | undefined
  context: FlowContext
  start: (next: Screen | Promise<Screen | void>) => void
}

interface HealthTarget {
  issue: Issue | undefined
  items: Item[] // the Memory listing, which holds the auto memory files and the MCP items' files
  context: FlowContext
  start: (next: Screen | Promise<Screen | void>) => void
}

// Health keys: f, r and e act on the issue; tab keys and the arrows fall through to pressKey.
function runHealthKey(name: string, { issue, items, context, start }: HealthTarget): boolean {
  if (KIND_KEYS[name]) return false
  const next = runIssueAction(name, issue && { issue, items, context })
  if (!next) return false
  start(next)
  return true
}

// List keys of each kind; returns false when the key is not an action.
function runAction(name: string, { kind, item, context, start }: ActionTarget): boolean {
  if (kind === "mcp" || kind === "plugin") {
    const next = (kind === "mcp" ? runMcpAction : runPluginAction)(name, item, context)
    if (next) start(next)
    return Boolean(next)
  }
  if (kind !== "memory" && kind !== "skill") return false
  if (name === "a") start(kind === "memory" ? addMemory(context) : newSkill(context))
  else if (!item) return false
  else if (name === "e" || name === "return") start(editItem(item, context))
  else if (name === "d") deleteItem(item, context)
  else if (kind === "skill" && (name === "c" || name === "m")) start(relocateSkill(item, name === "c" ? "copy" : "move", context))
  else return false
  return true
}

interface ActiveScreenProps {
  screen: Exclude<Screen, { name: "list" }>
  context: FlowContext
  backupRoot: string
  onApplied: (message: string) => void
  onOpenProject: (project: ProjectData) => void
}

function ActiveScreen({ screen, context, backupRoot, onApplied, onOpenProject }: ActiveScreenProps) {
  const back = context.back
  const toList = () => context.open(LIST)
  if (screen.name === "prompt") return <Prompt title={screen.title} nextStep={screen.nextStep} onDone={screen.onDone} onCancel={back} />
  if (screen.name === "editor") {
    const save = (text: string) => context.review(screen.toChange(text))
    return <TextEditor title={screen.title} label={screen.label} initialText={screen.initialText} onSave={save} onCancel={back} />
  }
  if (screen.name === "mcpForm") {
    const submit = (server: McpServer, targets: McpTarget[]) => context.review(...screen.toChanges(server, targets))
    const { title, server, targets, fixed } = screen
    return <McpForm title={title} server={server} targets={targets} adapters={context.adapters} fixed={fixed} onSubmit={submit} onCancel={back} />
  }
  if (screen.name === "marketplaces") {
    const add = () => context.open(addMarketplace(context))
    const remove = (marketplace: Marketplace) => removeMarketplace(marketplace, context)
    return <Marketplaces marketplaces={screen.marketplaces} onAdd={add} onRemove={remove} onBack={toList} />
  }
  if (screen.name === "projects") {
    const remove = (projects: ProjectData[]) => deleteProjects(projects, context)
    const { roots } = context
    return <Projects projects={screen.projects} current={roots.project} home={roots.home} onOpen={onOpenProject} onDelete={remove} onBack={toList} />
  }
  return <ReviewChanges plan={screen.plan} secrets={screen.secrets} backupRoot={backupRoot} home={context.roots.home} onApplied={onApplied} onBack={back} />
}

interface ShellKeyHandlers {
  filterNow: MutableRefObject<typeof NO_FILTER>
  setFilter: (next: typeof NO_FILTER) => void
  openHelp: () => void
  undo: () => void
  onQuit: () => void
}

// Keys that belong to the shell rather than the list; returns false when the list handles them.
function handleShellKey(key: { name: string; sequence?: string; shift?: boolean }, shell: ShellKeyHandlers): boolean {
  const typed = key.sequence ?? key.name
  if (shell.filterNow.current.active) shell.setFilter(filterKey(shell.filterNow.current, key.name, typed))
  else if (typed === "/") shell.setFilter({ text: "", active: true })
  else if (typed === "?") shell.openHelp()
  else if (key.name === "u" && !key.shift) shell.undo()
  else if (key.name === "escape") shell.setFilter(NO_FILTER)
  else if (key.name === "q") shell.onQuit()
  else return false
  return true
}

interface HelpState {
  open: boolean
  screen: Screen["name"]
  setOpen: (open: boolean) => void
  typing: boolean // a text input or text area has focus
}

// Any key closes Help; ? opens it over a screen other than the list (which opens it itself), unless a text field has focus, where ? is text.
function helpKey(key: { name: string; sequence?: string }, help: HelpState): boolean {
  if (help.open) help.setOpen(false)
  else if ((key.sequence ?? key.name) === "?" && help.screen !== "list" && !help.typing) help.setOpen(true)
  else return false
  return true
}

function isTyping(focused: unknown): boolean {
  return focused instanceof InputRenderable || focused instanceof TextareaRenderable
}

const START_VIEW: ViewState = { tab: "memory", focus: "list", harnessIndex: 0, listIndex: 0 }
const STEPS: Record<string, number> = { up: -1, down: 1 }

// While typing a filter: enter keeps it, esc clears it, backspace deletes, one printable character adds.
function filterKey(filter: typeof NO_FILTER, name: string, typed: string): typeof NO_FILTER {
  if (name === "return") return { ...filter, active: false }
  if (name === "escape") return NO_FILTER
  if (name === "backspace") return { ...filter, text: filter.text.slice(0, -1) }
  return typed.length === 1 && typed >= " " ? { ...filter, text: filter.text + typed } : filter
}

const HELP_WIDTH = 88
const HELP_SECTIONS: [string, KeyHint[]][] = [
  ["MOVE AROUND", [["1-5", "switch tab"], ["tab", "harnesses ↔ list"], ["↑↓", "move"], ["s", "next harness"], ["p", "switch project"], ["/", "filter by name"]]],
  ["MEMORY", [["a", "add file or entry"], ["e ⏎", "edit"], ["d", "delete"]]],
  ["SKILLS", SCREEN_KEYS.skill!.map(([key, label]): KeyHint => [key, key === "a" ? "new skill" : label])],
  ["MCP", [["a", "add server"], ...SCREEN_KEYS.mcp!.slice(1)]],
  ["PLUGINS", SCREEN_KEYS.plugin!],
  ["HEALTH", SCREEN_KEYS.health!],
  ["ANYWHERE", [["u", "undo last change"], ["?", "this help"], ["q", "quit"]]],
]
const HELP_COLUMNS = 3

// Every key, grouped by where it works, three to a line.
function Help({ width }: { width: number }) {
  const column = Math.floor((width - 4) / HELP_COLUMNS)
  return (
    <Dialog title="Keys" width={width}>
      <text fg={DIM} wrapMode="none">Every key, grouped by where it works. Press any key to close.</text>
      <text>{" "}</text>
      {HELP_SECTIONS.flatMap(([label, hints]) => [
        <text key={label} fg={ACCENT} wrapMode="none"><b>{label}</b></text>,
        ...chunk(hints, HELP_COLUMNS).map((line, index) => <HelpLine key={`${label}${index}`} hints={line} column={column} />),
        <text key={`${label} gap`}>{" "}</text>,
      ])}
    </Dialog>
  )
}

function HelpLine({ hints, column }: { hints: KeyHint[]; column: number }) {
  return (
    <text wrapMode="none">
      {hints.map(([key, text]) => (
        <span key={key}>
          <span fg={ACCENT}>{key}</span>
          <span fg={DIM}>{` ${text}`.padEnd(column - key.length)}</span>
        </span>
      ))}
    </text>
  )
}

function chunk<T>(values: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, index * size + size))
}

function pressKey(view: ViewState, key: KeyPress): ViewState {
  const tab = KIND_KEYS[key.name]
  const step = STEPS[key.name]
  if (tab) return { ...view, tab, listIndex: 0 }
  if (step) return move(view, step, key)
  if (key.name === "s") return { ...view, harnessIndex: (view.harnessIndex + 1) % (key.harnessCount + 1), listIndex: 0 }
  if (key.name === "tab") return { ...view, focus: view.focus === "list" ? "agents" : "list" }
  return view
}

function move(view: ViewState, step: number, key: KeyPress): ViewState {
  if (view.focus === "agents") return { ...view, harnessIndex: clamp(view.harnessIndex + step, key.harnessCount), listIndex: 0 }
  const last = key.listLength - 1
  return { ...view, listIndex: clamp(Math.min(view.listIndex, last) + step, last) }
}

function useDetected(adapters: HarnessAdapter[], roots: Roots): boolean[] {
  const [detected, setDetected] = useState<boolean[]>([])
  useEffect(() => {
    Promise.all(adapters.map((adapter) => adapter.detect(roots))).then(setDetected)
  }, [adapters, roots])
  return detected
}

// reloads: bump to list again after a change is applied.
function useListing(adapters: HarnessAdapter[], roots: Roots, kind: Kind, reloads: number) {
  const [listing, setListing] = useState({ items: [] as Item[], facts: new Map<Item, ReadFacts>(), error: "" })
  useEffect(() => {
    let live = true
    loadListing(adapters, roots, kind).then(
      (loaded) => live && setListing({ ...loaded, error: "" }),
      (error: Error) => live && setListing({ items: [], facts: new Map(), error: `Cannot list: ${error.message}` }),
    )
    return () => {
      live = false
    }
  }, [adapters, roots, kind, reloads])
  return listing
}

// The MCP rows show a transport and a secret flag, the plugin rows a version: only read() gives them.
async function loadListing(adapters: HarnessAdapter[], roots: Roots, kind: Kind) {
  const items = await listItems(adapters, kind, roots)
  const facts = new Map<Item, ReadFacts>()
  if (kind !== "mcp" && kind !== "plugin") return { items, facts }
  await Promise.all(
    items.map(async (item) => {
      const detail = await adapters.find((adapter) => adapter.id === item.harness)?.read(item)
      if (detail?.type === "mcp") facts.set(item, { transport: detail.server.transport, secret: literalSecrets(detail.server).length > 0 })
      // Only Claude Code's install record holds a version; Codex reports a cache folder name.
      if (detail?.type === "plugin" && item.harness === "claude-code") facts.set(item, { version: detail.plugin.version })
    }),
  )
  return { items, facts }
}

// Health skill issues per SKILL.md path, for the Skills NOTE column.
function skillChecks(issues: Issue[]): Map<string, number> {
  const checks = new Map<string, number>()
  for (const issue of issues) if (issue.kind === "skill") checks.set(issue.path, (checks.get(issue.path) ?? 0) + 1)
  return checks
}

function matchesHarness(item: Item, id: HarnessId): boolean {
  return item.harness === id || item.loadedBy.includes(id) || (item.offIn?.includes(id) ?? false)
}

function harnessRows(adapters: HarnessAdapter[], detected: boolean[], items: Item[]): HarnessRow[] {
  return adapters.map((adapter, index) => ({ adapter, detected: detected[index] ?? false, count: items.filter((item) => matchesHarness(item, adapter.id)).length }))
}

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(value, max))
}

interface HeaderProps {
  project: string
  home: string
  harness: string
  wide: boolean // the folded layout under 100 columns drops the path and the right-side keys
}

function Header({ project, home, harness, wide }: HeaderProps) {
  const place = wide ? `${basename(project)}  ${shortPath(tildePath(project, home), 40)}` : basename(project)
  return (
    <box flexShrink={0} flexDirection="row" justifyContent="space-between" backgroundColor={theme.raised} paddingLeft={1} paddingRight={1}>
      <text wrapMode="none">
        <span fg={ACCENT}><b>◆ agent-manager</b></span>
        <span fg={theme.faint}>{"  ╱  "}</span>
        <span fg={theme.text}>{place}</span>
        <span fg={theme.faint}>{"  ╱  "}</span>
        <span fg={DIM}>{harness}</span>
      </text>
      <text wrapMode="none" fg={DIM}>{wide ? "p project  s harness  ? keys" : "? keys"}</text>
    </box>
  )
}

const TAB_KEYS: Tab[] = ["memory", "skill", "mcp", "plugin", "health"]

function Tabs({ tab, counts, issues }: { tab: Tab; counts: number[] | null; issues: number }) {
  return (
    <box flexShrink={0} paddingLeft={1}>
      <text wrapMode="none">
        {TAB_NAMES.map((name, index) => {
          const active = TAB_KEYS[index] === tab
          const count = index === 4 ? ` ▲${issues}` : counts ? ` ${counts[index] ?? "—"}` : ""
          return (
            <span key={name}>
              <span fg={active ? theme.bg : theme.text} bg={active ? theme.accent : undefined}>{` ${name}`}</span>
              <span fg={active ? theme.bg : index === 4 ? theme.warn : DIM} bg={active ? theme.accent : undefined}>{`${count} `}</span>
              {"  "}
            </span>
          )
        })}
      </text>
    </box>
  )
}

// The item count of each tab, listed in the background so the tab row shows a number before it is opened.
function tabCounts(adapters: HarnessAdapter[], roots: Roots, reloads: number): number[] | null {
  const [counts, setCounts] = useState<number[] | null>(null)
  useEffect(() => {
    Promise.all(KINDS.map((kind) => listItems(adapters, kind, roots))).then(
      (lists) => setCounts(lists.map((items) => items.length)),
      () => setCounts(null),
    )
  }, [adapters, roots, reloads])
  return counts
}

function tabTitle(tab: Tab): string {
  return { memory: "Memory", skill: "Skills", mcp: "MCP servers", plugin: "Plugins", health: "Health" }[tab]
}

interface PanelTitleSource {
  tab: Tab
  groups: ListGroup[]
  filter: typeof NO_FILTER
  issues: number
  plugins: Item[]
}

// The right side of the list panel title: the counts, or the filter and how many rows match it.
function panelTitle({ tab, groups, filter, issues, plugins }: PanelTitleSource): [string, string] {
  const total = (list: ListGroup[]) => list.reduce((sum, group) => sum + group.total, 0)
  if (tab === "health") return [tabTitle(tab), countText(issues, ["issue", "issues"])]
  if (filter.active || filter.text) return [tabTitle(tab), `/ ${filter.text}${filter.active ? "▌" : ""} · ${groups.reduce((sum, group) => sum + group.rows.length, 0)} of ${total(groups)}`]
  const files = countText(total(groups.filter((group) => !group.auto)), groups[0]!.noun)
  const auto = groups.find((group) => group.auto)
  if (auto) return [tabTitle(tab), `${files} · ${countText(auto.total, auto.noun)}`]
  if (tab === "plugin") return [tabTitle(tab), `${files} · ${plugins.filter((item) => item.loadedBy.includes(item.harness)).length} on`]
  return [tabTitle(tab), files]
}

// The title text between the corners: name on the left, counts on the right, a rule between.
function titleBar([left, right]: [string, string], width: number): string {
  const rule = width - 4 - left.length - right.length - 4
  return rule < 1 ? ` ${left} ` : ` ${left} ${"─".repeat(rule)} ${right} `
}

const KINDS: Kind[] = ["memory", "skill", "mcp", "plugin"]
const LEFT_COLUMN_WIDTH = 28
const WIDE_FROM = 100 // under this many columns the left column folds away
const TALL_FROM = 30 // under this many rows the detail strip shrinks so the list keeps room

function shellLayout(width: number, height: number) {
  const left = width >= WIDE_FROM ? LEFT_COLUMN_WIDTH : 0
  return { left, rowWidth: Math.max(1, width - left - 3), strip: width >= WIDE_FROM && height >= TALL_FROM ? 10 : 5 }
}

function screenKeys(name: string): KeyHint[][] {
  const own = SCREEN_KEYS[name] ?? []
  if (name === "health") return [own, SHELL_KEYS.slice(1)]
  return KINDS.includes(name as Kind) ? [own, SHELL_KEYS] : [own]
}

function screenRight(name: Screen["name"]): string {
  return name === "prompt" ? "nothing is written until you review" : ""
}

interface SidePanelProps {
  title: string
  height?: number
  grow?: boolean // fills the rest of the left column, so both columns end on the same row
  focused: boolean
}

// The panel body is its own sibling box, so SidePanel needs no children parameter.
function sidePanelBorder(props: SidePanelProps) {
  return {
    height: props.height,
    flexGrow: props.grow ? 1 : 0,
    flexShrink: props.grow ? 1 : 0,
    border: true as const,
    borderStyle: "rounded" as const,
    borderColor: props.focused ? theme.borderActive : theme.border,
    title: props.title,
    titleColor: DIM,
    flexDirection: "column" as const,
    overflow: "hidden" as const,
  }
}

interface HarnessRow {
  adapter: HarnessAdapter
  detected: boolean
  count: number
}

interface LeftColumnProps {
  harnesses: HarnessRow[]
  selected: number
  focused: boolean
  project: string
  home: string
}

function LeftColumn({ harnesses, selected, focused, project, home }: LeftColumnProps) {
  return (
    <box width={LEFT_COLUMN_WIDTH} flexDirection="column" flexShrink={0}>
      <box {...sidePanelBorder({ title: " Harnesses ", height: harnesses.length + 3, focused })}>
        <HarnessesPane harnesses={harnesses} selected={selected} />
      </box>
      <box {...sidePanelBorder({ title: " Project ", height: 5, focused: false })}>
        <text wrapMode="none">{` ▸ ${basename(project)}`}</text>
        <text fg={DIM} wrapMode="none">{` ${shortPath(tildePath(project, home), LEFT_COLUMN_WIDTH - 4)}`}</text>
        <text wrapMode="none"><span fg={ACCENT}>{" p"}</span><span fg={DIM}>{" switch project"}</span></text>
      </box>
      <box {...sidePanelBorder({ title: " Legend ", grow: true, focused: false })}>
        <Legend harnessIds={harnesses.map((row) => row.adapter.id)} />
      </box>
    </box>
  )
}

const ROW_WIDTH = LEFT_COLUMN_WIDTH - 2

function HarnessesPane({ harnesses, selected }: { harnesses: HarnessRow[]; selected: number }) {
  const total = harnesses.reduce((sum, row) => sum + row.count, 0)
  const rows = [{ dot: " ", label: "All harnesses", count: String(total), ok: true }].concat(
    harnesses.map(({ adapter, detected, count }) => ({ dot: detected ? "●" : "○", label: adapter.label, count: detected ? String(count) : "not found", ok: detected })),
  )
  return (
    <box flexDirection="column">
      {rows.map((row, index) => (
        <text key={row.label} flexShrink={0} wrapMode="none" bg={index === selected ? SELECTED_BG : undefined}>
          <span fg={ACCENT}>{index === selected ? "▌" : " "}</span>
          <span fg={row.ok ? theme.ok : theme.faint}>{` ${row.dot} `}</span>
          <span fg={row.ok ? theme.text : DIM}>{`${row.label.padEnd(13)}${row.count.padStart(ROW_WIDTH - 17)} `}</span>
        </text>
      ))}
    </box>
  )
}

const LEGEND_MARKS: [string, string][] = [["✓", "loaded"], ["○", "installed, turned off"], ["·", "not read by harness"]]

function Legend({ harnessIds }: { harnessIds: HarnessId[] }) {
  const codes = chunk(harnessIds.map((id) => `${SHORT_CODES[id]} ${HARNESS_LABELS[id]}`), 2).map((pair) => ` ${pair.join("  ")}`)
  return (
    <box flexDirection="column">
      {LEGEND_MARKS.map(([mark, text]) => <text key={mark} wrapMode="none"><span fg={ACCENT}>{` ${mark}`}</span><span fg={DIM}>{` ${text}`}</span></text>)}
      <text>{" "}</text>
      {codes.map((line) => <text key={line} fg={DIM} wrapMode="none">{line}</text>)}
      <text>{" "}</text>
      <text fg={DIM} wrapMode="none">{" here uses in this project"}</text>
      <text fg={DIM} wrapMode="none">{" all  uses in all projects"}</text>
    </box>
  )
}

interface ListPanelProps {
  title: [string, string]
  width: number
  stripHeight: number
  focused: boolean
  list: ReactNode
  detail: ReactNode
}

// The list fills the panel; the detail strip under the dashed rule keeps a fixed height.
function ListPanel({ title, width, stripHeight, focused, list, detail }: ListPanelProps) {
  return (
    <box flexGrow={1} flexDirection="column" border borderStyle="rounded" borderColor={focused ? theme.borderActive : theme.border} title={titleBar(title, width)} titleColor={DIM} overflow="hidden">
      <box flexGrow={1} flexShrink={1} flexDirection="column" overflow="hidden">
        {list}
      </box>
      <text flexShrink={0} fg={theme.border} wrapMode="none">{"┄".repeat(Math.max(1, width - 2))}</text>
      <box height={stripHeight} flexShrink={0} flexDirection="column" overflow="hidden">
        {detail}
      </box>
    </box>
  )
}
