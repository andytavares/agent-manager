import { dirname } from "node:path"
import { HARNESS_LABELS, type HarnessId, type Item, type Kind } from "../core/model"
import { ACCENT, DIM, SELECTED_BG } from "./theme"
import type { UsageView } from "./usage"

export const SHORT_CODES: Record<HarnessId, string> = { "claude-code": "CC", codex: "Cx", opencode: "OC", omp: "omp" }

interface ItemListProps {
  kind: Kind
  items: Item[]
  selected: number
  harnessIds: HarnessId[]
  home: string
  transports: Map<Item, string> // MCP transport per item; Item has no transport field
  projectPath: string // the PROJECT group row names the current project
  usage: UsageView // Claude Code transcript counts per item, and the footer naming their range
}

// Both scopes at once: the GLOBAL items, then the PROJECT items under a row naming the current project.
export function ItemList({ kind, items, selected, harnessIds, home, projectPath, usage }: ItemListProps) {
  const table = TABLES[kind]
  const context = { harnessIds, home, usage }
  const groups = [
    { label: "GLOBAL", items: items.filter((item) => item.scope === "global") },
    { label: `PROJECT  ${tildePath(projectPath, home)}`, items: items.filter((item) => item.scope !== "global") },
  ]
  let index = 0
  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <text fg={DIM} wrapMode="none">{cells(table.header(harnessIds), table.widths(harnessIds))}</text>
      {groups.map((group) => (
        <box key={group.label} flexDirection="column">
          <text fg={ACCENT} wrapMode="none">{group.label}</text>
          {group.items.map((item) => (
            <text
              key={`${item.path}\0${item.key ?? ""}`}
              wrapMode="none"
              fg={item.readOnly || !item.loadedBy.includes(item.harness) ? DIM : undefined}
              bg={index++ === selected ? SELECTED_BG : undefined}
            >
              {cells(table.row(item, context), table.widths(harnessIds))}
            </text>
          ))}
        </box>
      ))}
      {usage.note !== "" && <text fg={DIM} wrapMode="none">{` ${usage.note}`}</text>}
    </box>
  )
}

interface RowContext {
  harnessIds: HarnessId[]
  home: string
  usage: UsageView
}

interface Table {
  widths(harnessIds: HarnessId[]): number[] // widths of every column but the last
  header(harnessIds: HarnessId[]): string[]
  row(item: Item, context: RowContext): string[]
}

const MARK_WIDTH = 4 // SHORT_CODES are 2 or 3 cells wide, so every mark column gets 4

const TABLES: Record<Kind, Table> = {
  memory: {
    widths: () => [28],
    header: () => ["FILE", "LOADED BY"],
    row: (item) => [item.name, item.loadedBy.map((id) => SHORT_CODES[id]).join(" ")],
  },
  mcp: {
    widths: (harnessIds) => [20, 10, ...harnessIds.map(() => MARK_WIDTH), 5, 6],
    header: (harnessIds) => ["NAME", "SOURCE", ...harnessIds.map((id) => SHORT_CODES[id]), "here", "all", "last used"],
    row: (item, { harnessIds, usage }) => [item.name, sourceOf(item), ...harnessIds.map((id) => mark(item, id)), ...usageCounts(item, usage)],
  },
  skill: {
    widths: (harnessIds) => [13, 21, ...harnessIds.map(() => MARK_WIDTH), 5, 6],
    header: (harnessIds) => ["SKILL", "ROOT", ...harnessIds.map((id) => SHORT_CODES[id]), "here", "all"],
    row: (item, { harnessIds, home, usage }) => [
      item.name,
      tildePath(dirname(item.path), home),
      ...harnessIds.map((id) => mark(item, id)),
      ...usageCounts(item, usage).slice(0, 2),
    ],
  },
  plugin: {
    widths: () => [19, 13, 7],
    header: () => ["PLUGIN", "HARNESS", "STATE", "SCOPE"],
    row: (item) => [item.name, HARNESS_LABELS[item.harness], item.loadedBy.includes(item.harness) ? "on" : "off", item.scope],
  },
}

// Where the entry comes from: Claude Code's own scope name, or the agent that owns the file.
function sourceOf(item: Item): string {
  if (item.harness !== "claude-code") return item.harness
  return item.scope === "global" ? "user" : item.scope
}

// ✓ loaded, ○ readable but off, · not read.
function mark(item: Item, id: HarnessId): string {
  if (item.loadedBy.includes(id)) return "✓"
  return item.offIn?.includes(id) ? "○" : "·"
}

// Only Claude Code transcripts are scanned, so a row it does not read shows no counts.
function usageCounts(item: Item, usage: UsageView): string[] {
  const found = usage.byItem.get(item)
  if (!found) return ["-", "-", "n/a"]
  return [String(found.here), String(found.all), found.last ?? "never"]
}

function cells(values: string[], widths: number[]): string {
  return ` ${values.map((value, index) => fit(value, widths[index])).join("")}`
}

function fit(value: string, width: number | undefined): string {
  if (width === undefined) return value
  return value.length < width ? value.padEnd(width) : `${value.slice(0, width - 2)}… `
}

export function tildePath(path: string, home: string): string {
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path
}
