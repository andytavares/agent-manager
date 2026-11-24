import { BorderChars } from "@opentui/core"
import type { ReactNode } from "react"
import { ACCENT, DIM, SELECTED_BG } from "./theme"

// When a row is too wide, a column gives way: note first, then path, then name. Fixed columns keep their width.
export type Give = "fixed" | "name" | "path" | "note"

export interface Column {
  header: string
  give: Give
}

export type Cell = [text: string, color?: string]

const GAP = 2
// A column that gives way keeps room for a short word such as "▲ secret" or "read-only".
const MIN_CELL = 10

// Yoga shrinks in proportion to flexShrink × width, so factors far apart make the columns give way nearly in turn.
const SHRINK: Record<Give, number> = { fixed: 0, name: 1, path: 1000, note: 1000000 }

export function columnWidths(columns: Column[], rows: Cell[][]): number[] {
  return columns.map((column, index) => Math.max(column.header.length, ...rows.map((cells) => cells[index]?.[0].length ?? 0)) + GAP)
}

const BAR = { ...BorderChars.single, vertical: "▌" }
const NO_BAR = { ...BorderChars.single, vertical: " " }

// The accent bar and the selection background cover every line of a wrapped row.
export function SelectableRow({ selected, children }: { selected: boolean; children: ReactNode }) {
  return (
    <box flexDirection="row" flexShrink={0} border={["left"]} borderColor={ACCENT} customBorderChars={selected ? BAR : NO_BAR} backgroundColor={selected ? SELECTED_BG : undefined}>
      {children}
    </box>
  )
}

interface CellsProps {
  cells: Cell[]
  columns: Column[]
  widths: number[]
  filter?: string
}

// A cell that does not fit wraps onto more lines; the name cell shows the filter match in the accent colour.
export function Cells({ cells, columns, widths, filter = "" }: CellsProps) {
  return (
    <box flexDirection="row" flexGrow={1} paddingLeft={1} columnGap={GAP}>
      {cells.map(([text, color], index) => (
        <text key={index} fg={color} width={widths[index]! - GAP} minWidth={Math.min(widths[index]! - GAP, MIN_CELL)} flexShrink={SHRINK[columns[index]!.give]} flexGrow={index === cells.length - 1 ? 1 : 0}>
          {index === 0 ? <Highlight text={text} filter={filter} /> : text}
        </text>
      ))}
    </box>
  )
}

export function CellHeader({ columns, widths }: { columns: Column[]; widths: number[] }) {
  return (
    <box flexDirection="row" flexShrink={0} paddingLeft={1}>
      <Cells cells={columns.map((column) => [column.header, DIM])} columns={columns} widths={widths} />
    </box>
  )
}

function Highlight({ text, filter }: { text: string; filter: string }) {
  const at = filter ? text.toLowerCase().indexOf(filter.toLowerCase()) : -1
  if (at < 0) return <span>{text}</span>
  return (
    <span>
      {text.slice(0, at)}
      <span fg={ACCENT}><b>{text.slice(at, at + filter.length)}</b></span>
      {text.slice(at + filter.length)}
    </span>
  )
}

// The width of a dialog that holds the table: the dialog border and padding (4), the row bar and cell padding (2), less the gap after the last column.
export function tableDialogWidth(widths: number[]): number {
  return widths.reduce((sum, width) => sum + width, 0) - GAP + 6
}
