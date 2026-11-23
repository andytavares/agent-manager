import { dirname } from "node:path"
import { HARNESS_LABELS, type HarnessId, type Item, type Kind } from "../core/model"
import { ACCENT, DIM, SELECTED_BG } from "./theme"

export const SHORT_CODES: Record<HarnessId, string> = { "claude-code": "CC", codex: "Cx", opencode: "OC", omp: "omp" }

interface ItemListProps {
  kind: Kind
  items: Item[]
  selected: number
  harnessIds: HarnessId[]
  home: string
  transports: Map<Item, string> // MCP transport per item; Item has no transport field
  projectPath: string // the PROJECT group row names the current project
}

// Both scopes at once: the GLOBAL items, then the PROJECT items under a row naming the current project.
export function ItemList({ kind, items, selected, harnessIds, home, transports, projectPath }: ItemListProps) {
  const table = TABLES[kind]
  const context = { harnessIds, home, transports }
  const groups = [
    { label: "GLOBAL", items: items.filter((item) => item.scope === "global") },
    { label: `PROJECT  ${tildePath(projectPath, home)}`, items: items.filter((item) => item.scope !== "global") },
  ]
  let index = 0
  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <text fg={DIM} wrapMode="none">{cells(table.header(harnessIds), table.widths)}</text>
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
              {cells(table.row(item, context), table.widths)}
            </text>
          ))}
        </box>
      ))}
    </box>
  )
}

interface RowContext {
  harnessIds: HarnessId[]
  home: string
  transports: Map<Item, string>
}

interface Table {
  widths: number[] // widths of every column but the last
  header(harnessIds: HarnessId[]): string[]
  row(item: Item, context: RowContext): string[]
}

const TABLES: Record<Kind, Table> = {
  memory: {
    widths: [28],
    header: () => ["FILE", "LOADED BY"],
    row: (item) => [item.name, item.loadedBy.map((id) => SHORT_CODES[id]).join(" ")],
  },
  mcp: {
    widths: [12, 7, 13],
    header: () => ["NAME", "TYPE", "HARNESS", "SOURCE"],
    row: (item, { home, transports }) => [
      item.name,
      transports.get(item) ?? "",
      HARNESS_LABELS[item.harness],
      item.readOnly ? "read-only" : tildePath(item.path, home),
    ],
  },
  skill: {
    widths: [13, 21, 4, 4, 4],
    header: (harnessIds) => ["SKILL", "ROOT", ...harnessIds.map((id) => SHORT_CODES[id])],
    row: (item, { harnessIds, home }) => [item.name, tildePath(dirname(item.path), home), ...harnessIds.map((id) => skillMark(item, id))],
  },
  plugin: {
    widths: [19, 13, 7],
    header: () => ["PLUGIN", "HARNESS", "STATE", "SCOPE"],
    row: (item) => [item.name, HARNESS_LABELS[item.harness], item.loadedBy.includes(item.harness) ? "on" : "off", item.scope],
  },
}

function skillMark(item: Item, id: HarnessId): string {
  if (item.loadedBy.includes(id)) return "✓"
  return item.offIn?.includes(id) ? "○" : "·"
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
