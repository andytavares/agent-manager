import { useKeyboard } from "@opentui/react"
import { useEffect, useReducer, useState } from "react"
import type { HarnessAdapter, HarnessId, Item, Kind, Roots } from "../core/model"
import { listItems } from "../core/registry"
import { DetailPane } from "./DetailPane"
import { ACCENT, DIM, ItemList, SELECTED_BG, tildePath } from "./ItemList"

type ScopeView = "global" | "project" // project shows project and local items
type Focus = "harness" | "list"

const KIND_KEYS: Record<string, Kind> = { "1": "memory", "2": "mcp", "3": "skill", "4": "plugin" }
const TAB_NAMES = ["1 Memory", "2 MCP", "3 Skills", "4 Plugins"]

interface AppProps {
  adapters: HarnessAdapter[]
  roots: Roots
  onQuit: () => void
}

export function App({ adapters, roots, onQuit }: AppProps) {
  const [view, dispatch] = useReducer(pressKey, START_VIEW)
  const detected = useDetected(adapters, roots)
  const listing = useListing(adapters, roots, view.kind)
  const { kind, scope, focus, harnessIndex } = view
  const inScope = listing.items.filter((item) => (scope === "global") === (item.scope === "global"))
  const harness = adapters[harnessIndex - 1]
  const visible = harness ? inScope.filter((item) => matchesHarness(item, harness.id)) : inScope
  const selected = Math.min(view.listIndex, visible.length - 1)
  const selectedItem = visible[selected]
  useKeyboard((key) => {
    if (key.name === "q") onQuit()
    else dispatch({ name: key.name, harnessCount: adapters.length, listLength: visible.length })
  })

  return (
    <box flexDirection="column" border width="100%" height="100%">
      <Header project={tildePath(roots.project, roots.home)} scope={scope} />
      <Tabs kind={kind} />
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
      <text flexShrink={0} fg={DIM}> 1-4 kind  s scope  tab next pane  ↑↓ move  q quit</text>
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

const START_VIEW: ViewState = { kind: "memory", scope: "global", focus: "list", harnessIndex: 0, listIndex: 0 }
const STEPS: Record<string, number> = { up: -1, down: 1 }

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

function useListing(adapters: HarnessAdapter[], roots: Roots, kind: Kind) {
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
  }, [adapters, roots, kind])
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
