import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useEffect, useMemo, useReducer, useRef, useState, type MutableRefObject, type ReactNode } from "react"
import { basename, dirname } from "node:path"
import type { AutoEntry } from "../memory/types"
import { search } from "../memory/fuzzy"
import { defaultBackupRoot } from "../core/apply"
import { undoLast } from "../core/undo"
import type { HarnessAdapter, HarnessId, Item, Kind, McpServer, ProjectData, Roots } from "../core/model"
import { listItems, literalSecrets, mergePlans, planChange } from "../core/registry"
import { DetailPane } from "./DetailPane"
import { entryItem, useEntries } from "./entries"
import { addMarketplace, addMemory, deleteItem, deleteProjects, editItem, type FlowContext, type Marketplace, marketplaceList, newSkill, projectList, relocateSkill, removeMarketplace, runMcpAction, runPluginAction, type Screen } from "./flows"
import { ItemList } from "./ItemList"
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
const LIST_KEYS = "u undo  1-5 tab  tab pane  s agent  p project  / filter  q quit"
const STATUS: Record<string, string> = {
  memory: `a add  e/enter edit  d delete  ${LIST_KEYS}  ? help`,
  skill: `a new skill  enter edit SKILL.md  c copy to…  m move to…  d delete  ${LIST_KEYS}  ? help`,
  mcp: `a add  e edit  c copy to…  d delete  space on/off  ${LIST_KEYS}  ? help`,
  plugin: `i install  space on/off  U update  x uninstall  m marketplaces  ${LIST_KEYS}  ? help`,
  health: `${LIST_KEYS}  ? help`,
  prompt: "↑↓ choose  enter next  esc cancel  ? help",
  editor: "ctrl+s review & save  esc discard  ? help",
  mcpForm: "tab next field  space toggle  ←→ change  enter review changes  esc cancel  ? help",
  review: "enter apply  esc back  ? help",
  marketplaces: "a add  d remove  esc back  ? help",
  projects: "space mark  d delete Claude Code data of marked or highlighted  enter open  esc keep current project  ? help",
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
  const { width } = useTerminalDimensions()
  const ruleWidth = Math.max(1, width - LEFT_COLUMN_WIDTH - 4) // the outer borders, the left column and the list panel's two borders
  const detected = useDetected(adapters, roots)
  const listing = useListing(adapters, roots, view.tab === "health" ? "memory" : view.tab, reloads)
  const usage = useUsage(listing.items, view.tab, roots)
  const entries = useEntries(roots, reloads)
  const { tab, focus, harnessIndex } = view
  const harness = adapters[harnessIndex - 1]
  const byHarness = harness ? listing.items.filter((item) => matchesHarness(item, harness.id)) : listing.items
  const visible = byNameFilter(byHarness, filter.text)
  const shown = tab === "memory" ? search(filter.text, entries.entries) : []
  const entryGroup = entries.dir === "" ? entries : { ...entries, entries: shown }
  const selected = Math.min(view.listIndex, visible.length + entryGroup.entries.length - 1)
  const selectedEntry = selected >= visible.length ? entryGroup.entries[selected - visible.length] : undefined
  const selectedItem = selectedEntry ? entryItem(selectedEntry) : visible[selected]
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
    help: showHelp,
    closeHelp: () => setShowHelp(false),
    setFilter,
    openHelp: () => setShowHelp(true),
    undo,
    onQuit,
  }
  useKeyboard((key) => {
    setMessage(NO_MESSAGE)
    if (screen.name !== "list") return
    if (handleShellKey(key, shellKeys)) return
    const name = key.shift && key.name.length === 1 ? key.name.toUpperCase() : key.name
    if (tab === "health") {
      if (KIND_KEYS[name] || name === "tab") dispatch({ name, harnessCount: adapters.length, listLength: 0 })
    }
    else if (!runAction(name, { kind: tab, item: selectedItem, context, start })) {
      dispatch({ name, harnessCount: adapters.length, listLength: visible.length + entryGroup.entries.length })
      if (name === "p") start(projectList(context))
    }
  })

  return (
    <box flexDirection="column" border width="100%" height="100%">
      <Header project={basename(roots.project)} agent={harness?.label ?? "All agents"} />
      <Tabs tab={tab} counts={tabCounts(adapters, roots, reloads)} />
      {showHelp ? (
        <Help />
      ) : screen.name !== "list" ? (
        <box border flexGrow={1} flexShrink={1} overflow="hidden">
          <ActiveScreen screen={screen} context={context} backupRoot={backupRoot} onApplied={onApplied} onOpenProject={openProject} />
        </box>
      ) : (
        <box flexDirection="row" flexGrow={1} flexShrink={1} overflow="hidden" backgroundColor={theme.bg}>
          <box width={LEFT_COLUMN_WIDTH} flexGrow={1} flexDirection="column" flexShrink={0}>
            <box {...sidePanelBorder({ title: " Agents ", height: adapters.length + 3, focused: focus === "agents" })}>
              <AgentsPane agents={agentsOf(adapters, detected, listing.items)} selected={harnessIndex} />
            </box>
            <box {...sidePanelBorder({ title: " Project ", focused: false, grow: true })}>
              <text wrapMode="none">{` ▸ ${basename(roots.project)}`}</text>
              <text fg={DIM} wrapMode="none">{" p switch  P delete"}</text>
            </box>
          </box>
          <box flexGrow={1} flexDirection="column" border borderStyle="rounded" borderColor={focus === "list" ? theme.borderActive : theme.border} title={` ${panelTitle(tab, listing.items.length)} `} titleColor={DIM} overflow="hidden">
            <box flexGrow={1} flexDirection="column" overflow="hidden">
              {tab === "health" ? (
                <text fg={DIM}> No issues.</text>
              ) : listing.error ? (
                <text fg={theme.err}>{listing.error}</text>
              ) : (
                <ItemList kind={tab} items={visible} selected={selected} harnessIds={adapters.map((a) => a.id)} home={roots.home} transports={listing.transports} projectPath={roots.project} usage={usage} entries={entryGroup} selectedEntry={selected >= visible.length ? selected - visible.length : -1} />
              )}
            </box>
            {tab !== "health" && (
              <box flexShrink={0} flexDirection="column" overflow="hidden">
                <text fg={theme.border} wrapMode="none">{"─".repeat(ruleWidth)}</text>
                <DetailPane item={selectedEntry ? undefined : selectedItem} entry={selectedEntry} siblings={entries.entries} adapter={adapters.find((a) => a.id === selectedItem?.harness)} home={roots.home} />
              </box>
            )}
          </box>
        </box>
      )}
      {message.text && <text flexShrink={0} fg={message.error ? theme.err : theme.ok}>{` ${message.text}`}</text>}
      {(filter.active || filter.text) && <text flexShrink={0} fg={ACCENT}>{` filter: ${filter.text}${filter.active ? "▌" : ""}`}</text>}
      <text flexShrink={0} fg={DIM}>{` ${fitKeys(STATUS[screen.name === "list" ? tab : screen.name]!, width)}`}</text>
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
    return <TextEditor title={screen.title} initialText={screen.initialText} onSave={save} onCancel={back} />
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
  help: boolean
  closeHelp: () => void
  setFilter: (next: typeof NO_FILTER) => void
  openHelp: () => void
  undo: () => void
  onQuit: () => void
}

// Keys that belong to the shell rather than the list; returns false when the list handles them.
function handleShellKey(key: { name: string; sequence?: string; shift?: boolean }, shell: ShellKeyHandlers): boolean {
  const typed = key.sequence ?? key.name
  if (shell.help) shell.closeHelp()
  else if (shell.filterNow.current.active) shell.setFilter(filterKey(shell.filterNow.current, key.name, typed))
  else if (typed === "/") shell.setFilter({ text: "", active: true })
  else if (typed === "?") shell.openHelp()
  else if (key.name === "u" && !key.shift) shell.undo()
  else if (key.name === "escape") shell.setFilter(NO_FILTER)
  else if (key.name === "q") shell.onQuit()
  else return false
  return true
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

const HELP_TABS: [string, string][] = [
  ["Memory", STATUS.memory!],
  ["Skills", STATUS.skill!],
  ["MCP", STATUS.mcp!],
  ["Plugins", STATUS.plugin!],
  ["Health", STATUS.health!],
  ["Projects", STATUS.projects!],
]

function Help() {
  return (
    <box border borderStyle="rounded" borderColor={theme.border} flexGrow={1} flexDirection="column" paddingLeft={1} title=" Help " titleColor={ACCENT}>
      <text fg={DIM}>Keys (any key closes)</text>
      {HELP_TABS.map(([tab, keys]) => <text key={tab} wrapMode="none">{`${tab.padEnd(9)}${keys}`}</text>)}
      <text>{"Everywhere / filter by name  ? help  esc clears the filter"}</text>
    </box>
  )
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
  const [listing, setListing] = useState({ items: [] as Item[], transports: new Map<Item, string>(), error: "" })
  useEffect(() => {
    let live = true
    loadListing(adapters, roots, kind).then(
      (loaded) => live && setListing({ ...loaded, error: "" }),
      (error: Error) => live && setListing({ items: [], transports: new Map(), error: `Cannot list: ${error.message}` }),
    )
    return () => {
      live = false
    }
  }, [adapters, roots, kind, reloads])
  return listing
}

// The MCP list shows a transport, which only read() gives.
async function loadListing(adapters: HarnessAdapter[], roots: Roots, kind: Kind) {
  const items = await listItems(adapters, kind, roots)
  const transports = new Map<Item, string>()
  if (kind !== "mcp") return { items, transports }
  await Promise.all(
    items.map(async (item) => {
      const detail = await adapters.find((adapter) => adapter.id === item.harness)?.read(item)
      if (detail?.type === "mcp") transports.set(item, detail.server.transport)
    }),
  )
  return { items, transports }
}

function matchesHarness(item: Item, id: HarnessId): boolean {
  return item.harness === id || item.loadedBy.includes(id) || (item.offIn?.includes(id) ?? false)
}

// Every tab but Memory: keep the items whose name holds the filter text.
function byNameFilter(items: Item[], text: string): Item[] {
  return items.filter((item) => item.name.toLowerCase().includes(text.toLowerCase()))
}

function agentsOf(adapters: HarnessAdapter[], detected: boolean[], items: Item[]): AgentsPaneProps["agents"] {
  return adapters.map((adapter, index) => ({ adapter, detected: detected[index] ?? false, count: items.filter((item) => matchesHarness(item, adapter.id)).length }))
}

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(value, max))
}

function Header({ project, agent }: { project: string; agent: string }) {
  return (
    <box flexShrink={0} flexDirection="row" justifyContent="space-between" backgroundColor={theme.bg} paddingLeft={1} paddingRight={1}>
      <text>
        <span fg={ACCENT}><b> agent-manager</b></span>
        <span fg={theme.group}>{`  ${project}`}</span>
      </text>
      <text>
        <span fg={DIM}>{`${agent} · s agent  ? help`}</span>
      </text>
    </box>
  )
}

function Tabs({ tab, counts }: { tab: Tab; counts: number[] | null }) {
  return (
    <box flexShrink={0} backgroundColor={theme.bg} paddingLeft={1} paddingRight={1}>
      <text>
        {TAB_NAMES.map((name) => (
          <span key={name} fg={name.slice(2) === tabTitle(tab) ? theme.selFg : DIM} bg={name.slice(2) === tabTitle(tab) ? SELECTED_BG : undefined}>
            {` ${name}${counts ? ` ${counts[TAB_NAMES.indexOf(name)] ?? "—"}` : ""}  `}
          </span>
        ))}
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

// The list panel title carries the row count shown in it.
function panelTitle(tab: Tab, count: number): string {
  return tab === "health" ? tabTitle(tab) : `${tabTitle(tab)} · ${count}`
}

const KINDS: Kind[] = ["memory", "skill", "mcp", "plugin"]
const LEFT_COLUMN_WIDTH = 30

// Keeps the leading key hints that fit in width, always ending with "? help".
export function fitKeys(text: string, width: number): string {
  const keys = text.split("  ")
  const help = keys.pop()!
  const kept: string[] = []
  for (const key of keys) {
    if ([...kept, key, help].join("  ").length + KEY_BAR_PADDING > width) break
    kept.push(key)
  }
  return [...kept, help].join("  ")
}

const KEY_BAR_PADDING = 1

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
    flexShrink: 0,
    border: true as const,
    borderStyle: "rounded" as const,
    borderColor: props.focused ? theme.borderActive : theme.border,
    title: props.title,
    titleColor: DIM,
    flexDirection: "column" as const,
    paddingLeft: 1,
    overflow: "hidden" as const,
  }
}

interface AgentsPaneProps {
  agents: { adapter: HarnessAdapter; detected: boolean; count: number }[]
  selected: number
}

function AgentsPane({ agents, selected }: AgentsPaneProps) {
  const rows = [{ label: "  All", count: String(agents.reduce((total, agent) => total + agent.count, 0)) }].concat(
    agents.map(({ adapter, detected, count }) => ({ label: `${detected ? "●" : "○"} ${adapter.label}`, count: detected ? String(count) : "—" })),
  )
  return (
    <box flexDirection="column">
      {rows.map((row, index) => (
        <text key={row.label} wrapMode="none" fg={index === selected ? theme.selFg : undefined} bg={index === selected ? SELECTED_BG : undefined}>
          {` ${row.label.padEnd(22)}${row.count.padStart(3)} `}
        </text>
      ))}
    </box>
  )
}
