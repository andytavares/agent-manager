import { dirname } from "node:path"
import type { ReactNode } from "react"
import { HARNESS_LABELS, type HarnessId, type Item, type Kind } from "../core/model"
import { search } from "../memory/fuzzy"
import { pad, shortPath } from "../memory/format"
import type { AutoEntry } from "../memory/types"
import { entryItem, type EntriesView } from "./entries"
import { budgetRow, entryRow } from "./MemoryEntries"
import { ScrollList, type ScrollRow } from "./ScrollList"
import { ACCENT, DIM, SELECTED_BG, theme } from "./theme"
import type { UsageView } from "./usage"

export const SHORT_CODES: Record<HarnessId, string> = { "claude-code": "CC", codex: "Cx", opencode: "OC", omp: "omp" }

// One selectable row: an item, or an auto memory entry with the item that stands for it.
export interface ListRow {
  id: string
  item: Item
  entry?: AutoEntry
}

export interface ListGroup {
  label: string
  noun: [string, string] // singular and plural, for the "7 files" count
  rows: ListRow[]
  total: number // rows before the filter
  auto?: boolean // the AUTO MEMORY group, which ends with the MEMORY.md budget
}

// What read() adds to a row: the MCP transport and secret flag, the plugin version.
export interface ReadFacts {
  transport?: string
  secret?: boolean
  version?: string
}

const NOUNS: Record<Kind, [string, string]> = { memory: ["file", "files"], skill: ["skill", "skills"], mcp: ["server", "servers"], plugin: ["plugin", "plugins"] }

interface GroupSource {
  kind: Kind
  items: Item[]
  entries: EntriesView
  filter: string
  place: string // the PROJECT group row names the current project
}

const nameMatches = (item: Item, filter: string) => item.name.toLowerCase().includes(filter.toLowerCase())
const rowOf = (item: Item): ListRow => ({ id: `${item.path}\0${item.key ?? ""}`, item })

// GLOBAL, then PROJECT, then on Memory the auto memory entries: the one order that highlight, detail and keys share.
export function listGroups({ kind, items, entries, filter, place }: GroupSource): ListGroup[] {
  const inAutoMemory = (item: Item) => entries.dir !== "" && item.path.startsWith(`${entries.dir}/`)
  const global = items.filter((item) => item.scope === "global")
  const project = items.filter((item) => item.scope !== "global" && !inAutoMemory(item))
  const group = (label: string, scoped: Item[]): ListGroup => ({ label, noun: NOUNS[kind], rows: scoped.filter((item) => nameMatches(item, filter)).map(rowOf), total: scoped.length })
  const groups = [group("GLOBAL", global), group(`PROJECT  ${place}`, project)]
  if (kind !== "memory" || entries.dir === "") return groups
  const shown = filter ? search(filter, entries.entries) : entries.entries
  const rows = shown.map((entry) => ({ id: entry.path, item: entryItem(entry), entry }))
  return [...groups, { label: "AUTO MEMORY", noun: ["entry", "entries"], rows, total: entries.entries.length, auto: true }]
}

export const countText = (count: number, [one, many]: [string, string]) => `${count} ${count === 1 ? one : many}`

export interface RowContext {
  harnessIds: HarnessId[]
  home: string
  project: string
  usage: UsageView
  facts: Map<Item, ReadFacts>
  checks: Map<string, number> // Health skill issues per SKILL.md path
}

interface ItemListProps {
  kind: Kind
  groups: ListGroup[]
  selectedId: string | undefined
  width: number // the row width inside the panel
  filter: string
  context: RowContext
  entriesDir: string
}

// The column header stays put; the group and item rows scroll under it.
export function ItemList({ kind, groups, selectedId, width, filter, context, entriesDir }: ItemListProps) {
  const table = TABLES[kind]
  const columns = table.columns(context.harnessIds)
  const rows = groups.flatMap((group) => groupRows({ group, filter, draw: (row) => (row.entry ? entryRow(row.entry, width) : <ItemRow cells={table.row(row.item, context)} widths={columns.map((column) => column.width)} filter={filter} width={width} />), entriesDir, width }))
  const selectable = new Set(groups.flatMap((group) => group.rows.map((row) => row.id)))
  const marked = rows.map((row) => (selectable.has(row.id) ? { ...row, node: <RowFrame selected={row.id === selectedId} width={width}>{row.node}</RowFrame> } : row))
  return (
    <box flexDirection="column" flexGrow={1} overflow="hidden">
      <text fg={DIM} wrapMode="none">{`  ${columns.map((column) => pad(column.header, column.width)).join("")}${table.lastHeader}`.slice(0, width)}</text>
      <ScrollList rows={marked} selectedId={selectedId} />
      {context.usage.note !== "" && <text fg={DIM} wrapMode="none">{`  ${context.usage.note}`.slice(0, width)}</text>}
    </box>
  )
}

interface GroupRowsProps {
  group: ListGroup
  filter: string
  draw: (row: ListRow) => ReactNode
  entriesDir: string
  width: number
}

function groupRows({ group, filter, draw, entriesDir, width }: GroupRowsProps): ScrollRow[] {
  const count = filter ? `${group.rows.length} of ${group.total}` : countText(group.total, group.noun)
  const head = { id: `group\0${group.label}`, node: <GroupRow label={group.label} count={count} width={width} /> }
  const rows = group.rows.map((row) => ({ id: row.id, node: draw(row) }))
  const empty = filter && group.rows.length === 0 ? [{ id: `empty\0${group.label}`, node: <text fg={DIM} wrapMode="none">{`  No entry matches “${filter}”.`}</text> }] : []
  const budget = group.auto && !filter ? [{ id: `budget\0${group.label}`, node: budgetRow(entriesDir) }] : []
  return [head, ...rows, ...empty, ...budget]
}

function GroupRow({ label, count, width }: { label: string; count: string; width: number }) {
  const rule = Math.max(1, width - label.length - count.length - 4)
  return (
    <text wrapMode="none">
      <span fg={ACCENT}><b>{` ${label} `}</b></span>
      <span fg={theme.faint}>{"─".repeat(rule)}</span>
      <span fg={DIM}>{` ${count} `}</span>
    </text>
  )
}

// The first cell holds the selected row's accent bar; the selection background runs across the row.
function RowFrame({ selected, width, children }: { selected: boolean; width: number; children: ReactNode }) {
  return (
    <box width={width} flexDirection="row" backgroundColor={selected ? SELECTED_BG : undefined}>
      <text fg={ACCENT} wrapMode="none">{selected ? "▌" : " "}</text>
      <box flexGrow={1}>{children}</box>
    </box>
  )
}

export type Cell = [text: string, color?: string]

interface ItemRowProps {
  cells: Cell[]
  widths: number[]
  filter: string
  width: number
}

// Cells are padded to their column; the name cell shows the filter match in the accent colour.
function ItemRow({ cells, widths, filter, width }: ItemRowProps) {
  const [name, nameColor] = cells[0]!
  const rest = cells.slice(1)
  const texts = cells.map(([text], index) => (widths[index] === undefined ? text : pad(text, widths[index]!)))
  const room = Math.max(0, width - 2 - texts.slice(0, -1).join("").length)
  return (
    <text wrapMode="none" fg={nameColor}>
      {" "}
      <Highlight text={texts[0]!} filter={filter} plain={name} />
      {rest.map(([, color], index) => {
        const text = texts[index + 1]!
        return <span key={index} fg={color}>{index === rest.length - 1 ? text.slice(0, room) : text}</span>
      })}
    </text>
  )
}

function Highlight({ text, filter, plain }: { text: string; filter: string; plain: string }) {
  const at = filter ? plain.toLowerCase().indexOf(filter.toLowerCase()) : -1
  if (at < 0) return <span>{text}</span>
  return (
    <span>
      {text.slice(0, at)}
      <span fg={ACCENT}><b>{text.slice(at, at + filter.length)}</b></span>
      {text.slice(at + filter.length)}
    </span>
  )
}

interface Column {
  header: string
  width: number
}

interface Table {
  columns(harnessIds: HarnessId[]): Column[] // every column but the last
  lastHeader: string
  row(item: Item, context: RowContext): Cell[]
}

const MARK_WIDTH = 5 // SHORT_CODES are 2 or 3 cells wide

const markColumns = (harnessIds: HarnessId[]) => harnessIds.map((id) => ({ header: SHORT_CODES[id], width: MARK_WIDTH }))
const isOff = (item: Item) => Boolean(item.readOnly) || item.loadedBy.length === 0
const dimIfOff = (item: Item) => (isOff(item) ? DIM : undefined)

const TABLES: Record<Kind, Table> = {
  memory: {
    columns: () => [{ header: "FILE", width: 30 }, { header: "LOADED BY", width: 22 }],
    lastHeader: "NOTE",
    row: (item) => [[item.name, dimIfOff(item)], loadedByCell(item), memoryNote(item)],
  },
  skill: {
    columns: (harnessIds) => [{ header: "SKILL", width: 14 }, { header: "FOLDER", width: 30 }, ...markColumns(harnessIds), { header: "here", width: 6 }, { header: "all", width: 6 }],
    lastHeader: "NOTE",
    row: (item, context) => [[item.name, dimIfOff(item)], [skillFolder(item, context), dimIfOff(item)], ...marks(item, context), ...usageCells(item, context).slice(0, 2), skillNote(item, context)],
  },
  mcp: {
    columns: (harnessIds) => [{ header: "SERVER", width: 14 }, { header: "TYPE", width: 7 }, { header: "DEFINED IN", width: 22 }, ...markColumns(harnessIds), { header: "here", width: 6 }, { header: "last used", width: 11 }],
    lastHeader: "NOTE",
    row: (item, context) => [
      [item.name, dimIfOff(item)],
      [context.facts.get(item)?.transport ?? "", DIM],
      [shortPath(placePath(item.path, context), 21), DIM],
      ...marks(item, context),
      ...[usageCells(item, context)[0]!, usageCells(item, context)[2]!],
      mcpNote(item, context),
    ],
  },
  plugin: {
    columns: () => [{ header: "PLUGIN", width: 20 }, { header: "HARNESS", width: 14 }, { header: "STATE", width: 10 }, { header: "VERSION", width: 10 }],
    lastHeader: "MARKETPLACE",
    row: (item, context) => [
      [item.name.split("@")[0]!, dimIfOff(item)],
      [HARNESS_LABELS[item.harness], DIM],
      item.loadedBy.includes(item.harness) ? ["● on", theme.ok] : ["○ off", theme.faint],
      [context.facts.get(item)?.version ?? "–", DIM],
      [item.name.split("@")[1] ?? "", DIM],
    ],
  },
}

function loadedByCell(item: Item): Cell {
  if (item.loadedBy.length === 0) return ["nobody", theme.warn]
  return [item.loadedBy.map((id) => HARNESS_LABELS[id]).join(", ")]
}

const GENERATED_BY_CODEX = "generated by Codex"

// The first warning, else what makes the file special.
function memoryNote(item: Item): Cell {
  const warning = item.warnings?.find((text) => !text.startsWith(GENERATED_BY_CODEX))
  if (warning) return [`▲ ${warning}`, theme.warn]
  if (item.warnings?.some((text) => text.startsWith(GENERATED_BY_CODEX))) return ["generated memory", DIM]
  if (item.path.endsWith("/CLAUDE.local.md")) return ["private to you", DIM]
  return [""]
}

// Plugin skills name their plugin; the others name the folder that holds them.
function skillFolder(item: Item, context: RowContext): string {
  const plugin = item.readOnly?.match(/^from plugin (.+)$/)?.[1]
  return plugin ? `plugin ${plugin}` : shortPath(placePath(dirname(item.path), context), 29)
}

function skillNote(item: Item, context: RowContext): Cell {
  const checks = context.checks.get(`${item.path}/SKILL.md`) ?? 0
  if (checks > 0) return [`▲ ${checks} check${checks === 1 ? "" : "s"}`, theme.warn]
  return item.readOnly ? ["read-only", DIM] : [""]
}

function mcpNote(item: Item, context: RowContext): Cell {
  if (context.facts.get(item)?.secret) return ["▲ secret", theme.warn]
  return item.loadedBy.length === 0 ? ["off", DIM] : [""]
}

// A project path shows relative to the project; the rest start at ~.
function placePath(path: string, { home, project }: RowContext): string {
  return path.startsWith(`${project}/`) ? path.slice(project.length + 1) : tildePath(path, home)
}

// ✓ loaded, ○ readable but off, · not read.
function marks(item: Item, { harnessIds }: RowContext): Cell[] {
  return harnessIds.map((id) => {
    if (item.loadedBy.includes(id)) return ["✓", theme.ok]
    return item.offIn?.includes(id) ? ["○", DIM] : ["·", theme.faint]
  })
}

// Only Claude Code transcripts are scanned, so a row it does not read shows dashes.
function usageCells(item: Item, { usage }: RowContext): Cell[] {
  const found = usage.byItem.get(item)
  if (!found) return [["–", DIM], ["–", DIM], ["–", DIM]]
  return [[String(found.here)], [String(found.all)], [found.last ?? "never", DIM]]
}

export function tildePath(path: string, home: string): string {
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path
}
