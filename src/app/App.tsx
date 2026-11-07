import { useKeyboard } from "@opentui/react"
import { useEffect, useMemo, useReducer, useRef, useState } from "react"
import { basename } from "node:path"
import { defaultBackupRoot } from "../core/apply"
import type { HarnessAdapter, HarnessId, Item, Kind, McpServer, ProjectData, Roots } from "../core/model"
import { listItems, literalSecrets, mergePlans, planChange } from "../core/registry"
import { DetailPane } from "./DetailPane"
import { addMarketplace, addMemory, deleteItem, deleteProjects, editItem, type FlowContext, type Marketplace, marketplaceList, newSkill, projectList, relocateSkill, removeMarketplace, runMcpAction, runPluginAction, type Screen } from "./flows"
import { ACCENT, DIM, ItemList, SELECTED_BG, tildePath } from "./ItemList"
import { Marketplaces } from "./Marketplaces"
import { McpForm, type McpTarget } from "./McpForm"
import { Projects } from "./Projects"
import { Prompt } from "./Prompt"
import { ReviewChanges } from "./ReviewChanges"
import { TextEditor } from "./TextEditor"

type ScopeView = "global" | "project" // project shows project and local items
type Focus = "harness" | "list"
type ListScreen = "list" | "projects" | "marketplaces" // where back and apply return to

const KIND_KEYS: Record<string, Kind> = { "1": "memory", "2": "mcp", "3": "skill", "4": "plugin" }
const TAB_NAMES = ["1 Memory", "2 MCP", "3 Skills", "4 Plugins"]
const LIST: Screen = { name: "list" }
const NO_MESSAGE = { text: "", error: false }
const NO_FILTER = { text: "", active: false }
const LIST_KEYS = "1-4 kind  s scope  tab pane  / filter  ? help  q quit"
const STATUS: Record<string, string> = {
  memory: `a add  e/enter edit  d delete  ${LIST_KEYS}`,
  skill: `a new skill  enter edit SKILL.md  c copy to…  m move to…  d delete  ${LIST_KEYS}`,
  mcp: `a add  e edit  c copy to…  d delete  space on/off  ${LIST_KEYS}`,
  plugin: "i install  space on/off  u update  x uninstall  m marketplaces  s scope  / filter  ? help",
  prompt: "↑↓ choose  enter next  esc cancel",
  editor: "ctrl+s review & save  esc discard",
  mcpForm: "tab next field  space toggle  ←→ change  enter review changes  esc cancel",
  review: "enter apply  esc back",
  marketplaces: "a add  d remove  esc back",
  projects: "space mark  d delete Claude Code data of marked or highlighted  enter open  esc keep current project",
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
  const detected = useDetected(adapters, roots)
  const listing = useListing(adapters, roots, view.kind, reloads)
  const { kind, scope, focus, harnessIndex } = view
  const inScope = listing.items.filter((item) => (scope === "global") === (item.scope === "global"))
  const harness = adapters[harnessIndex - 1]
  const byHarness = harness ? inScope.filter((item) => matchesHarness(item, harness.id)) : inScope
  const visible = byHarness.filter((item) => item.name.toLowerCase().includes(filter.text.toLowerCase()))
  const selected = Math.min(view.listIndex, visible.length - 1)
  const selectedItem = visible[selected]
  const fail = (error: Error) => {
    setMessage({ text: error.message, error: true })
    show(LIST)
  }
  const start = (next: Screen | Promise<Screen | void>) => Promise.resolve(next).then((screen) => screen && show(screen), fail)
  const context: FlowContext = {
    adapters: adapters.filter((_, index) => detected[index]),
    roots,
    scope,
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
  useKeyboard((key) => {
    setMessage(NO_MESSAGE)
    if (screen.name !== "list") return
    const typed = key.sequence ?? key.name
    if (showHelp) setShowHelp(false)
    else if (filterNow.current.active) setFilter(filterKey(filterNow.current, key.name, typed))
    else if (typed === "/") setFilter({ text: "", active: true })
    else if (typed === "?") setShowHelp(true)
    else if (key.name === "escape") setFilter(NO_FILTER)
    else if (key.name === "q") onQuit()
    else if (!runAction(key.name, { kind, item: selectedItem, context, start })) {
      dispatch({ name: key.name, harnessCount: adapters.length, listLength: visible.length })
      if (key.name === "s" && scope === "global") start(projectList(context))
    }
  })

  return (
    <box flexDirection="column" border width="100%" height="100%">
      <Header project={tildePath(roots.project, roots.home)} scope={scope} />
      <Tabs kind={kind} />
      {showHelp ? (
        <Help />
      ) : screen.name !== "list" ? (
        <box border flexGrow={1} flexShrink={1} overflow="hidden">
          <ActiveScreen screen={screen} context={context} backupRoot={backupRoot} onApplied={onApplied} onOpenProject={openProject} />
        </box>
      ) : (
        <box flexDirection="row" flexGrow={1} flexShrink={1} overflow="hidden">
          <box border width={22} overflow="hidden" borderColor={focus === "harness" ? ACCENT : undefined}>
            <HarnessPane adapters={adapters} detected={detected} counts={countByHarness(adapters, inScope)} selected={harnessIndex} />
          </box>
          <box border flexGrow={1} overflow="hidden" borderColor={focus === "list" ? ACCENT : undefined}>
            {listing.error ? (
              <text fg="#ff5f5f">{listing.error}</text>
            ) : (
              <ItemList kind={kind} items={visible} selected={selected} harnessIds={adapters.map((a) => a.id)} home={roots.home} transports={listing.transports} />
            )}
          </box>
          <box border width={36} overflow="hidden">
            <DetailPane item={selectedItem} adapter={adapters.find((a) => a.id === selectedItem?.harness)} home={roots.home} />
          </box>
        </box>
      )}
      {message.text && <text flexShrink={0} fg={message.error ? ERROR : ACCENT}>{` ${message.text}`}</text>}
      {(filter.active || filter.text) && <text flexShrink={0} fg={ACCENT}>{` filter: ${filter.text}${filter.active ? "▌" : ""}`}</text>}
      <text flexShrink={0} fg={DIM}>{` ${STATUS[screen.name === "list" ? kind : screen.name]}`}</text>
    </box>
  )
}

interface ViewState {
  kind: Kind
  scope: ScopeView
  focus: Focus
  harnessIndex: number // 0 = All, else adapters[harnessIndex - 1]
  listIndex: number
}

interface KeyPress {
  name: string
  harnessCount: number
  listLength: number
}

const ERROR = "#ff5f5f"

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

const START_VIEW: ViewState = { kind: "memory", scope: "global", focus: "list", harnessIndex: 0, listIndex: 0 }
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
  ["MCP", STATUS.mcp!],
  ["Skills", STATUS.skill!],
  ["Plugins", STATUS.plugin!],
]

function Help() {
  return (
    <box border flexGrow={1} flexDirection="column" paddingLeft={1}>
      <text fg={ACCENT}>Keys (any key closes)</text>
      {HELP_TABS.map(([tab, keys]) => <text key={tab}>{`${tab.padEnd(9)}${keys}`}</text>)}
      <text>{"Everywhere / filter by name  ? help  esc clears the filter"}</text>
    </box>
  )
}

function pressKey(view: ViewState, key: KeyPress): ViewState {
  const kind = KIND_KEYS[key.name]
  const step = STEPS[key.name]
  if (kind) return { ...view, kind, listIndex: 0 }
  if (step) return move(view, step, key)
  if (key.name === "s") return { ...view, scope: view.scope === "global" ? "project" : "global", listIndex: 0 }
  if (key.name === "tab") return { ...view, focus: view.focus === "list" ? "harness" : "list" }
  return view
}

function move(view: ViewState, step: number, key: KeyPress): ViewState {
  if (view.focus === "harness") return { ...view, harnessIndex: clamp(view.harnessIndex + step, key.harnessCount), listIndex: 0 }
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

function countByHarness(adapters: HarnessAdapter[], items: Item[]): number[] {
  return [items.length, ...adapters.map((adapter) => items.filter((item) => matchesHarness(item, adapter.id)).length)]
}

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(value, max))
}

function Header({ project, scope }: { project: string; scope: ScopeView }) {
  return (
    <box flexShrink={0} flexDirection="row" justifyContent="space-between">
      <text>
        <span fg={ACCENT}> agent-manager</span>
        <span fg={DIM}>  project: </span>
        {project}
      </text>
      <text>
        <span fg={DIM}>scope: </span>
        <ScopeLabel name="Global" active={scope === "global"} />
        {" "}
        <ScopeLabel name="Project" active={scope === "project"} />
      </text>
    </box>
  )
}

function ScopeLabel({ name, active }: { name: string; active: boolean }) {
  return active ? <span bg={SELECTED_BG}>{` ${name} `}</span> : <span fg={DIM}>{name}</span>
}

function Tabs({ kind }: { kind: Kind }) {
  const activeKey = Object.keys(KIND_KEYS).find((key) => KIND_KEYS[key] === kind)
  return (
    <text flexShrink={0}>
      {TAB_NAMES.map((name) => (
        <span key={name} fg={name[0] === activeKey ? undefined : DIM} bg={name[0] === activeKey ? SELECTED_BG : undefined}>
          {`  ${name}  `}
        </span>
      ))}
    </text>
  )
}

interface HarnessPaneProps {
  adapters: HarnessAdapter[]
  detected: boolean[]
  counts: number[]
  selected: number
}

function HarnessPane({ adapters, detected, counts, selected }: HarnessPaneProps) {
  const rows = [{ label: "  All", count: String(counts[0]) }].concat(
    adapters.map((adapter, index) => ({
      label: `${detected[index] ? "●" : "○"} ${adapter.label}`,
      count: detected[index] ? String(counts[index + 1]) : "—",
    })),
  )
  return (
    <box flexDirection="column">
      <text fg={DIM}> HARNESSES</text>
      <text> </text>
      {rows.map((row, index) => (
        <text key={row.label} wrapMode="none" bg={index === selected ? SELECTED_BG : undefined}>
          {` ${row.label.padEnd(15)}${row.count.padStart(3)}`}
        </text>
      ))}
    </box>
  )
}
