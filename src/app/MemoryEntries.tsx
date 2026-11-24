import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { countLines, INDEX_BYTE_LIMIT, INDEX_LINE_LIMIT } from "../memory/entry"
import { bar } from "../memory/format"
import type { AutoEntry } from "../memory/types"
import { Cells, type Cell, type Column } from "./CellRow"
import { ACCENT, DIM, theme } from "./theme"

const TYPE_COLOR: Record<string, string> = { feedback: theme.warn, reference: ACCENT, project: theme.ok, user: theme.text }

// AUTO MEMORY rows have no header line.
export const ENTRY_COLUMNS: Column[] = [{ header: "", give: "fixed" }, { header: "", give: "name" }, { header: "", give: "note" }]

// One AUTO MEMORY row: type, title, then the first flag the entry carries.
export function entryCells(entry: AutoEntry): Cell[] {
  const type = entry.type ?? "-"
  return [[type, TYPE_COLOR[type] ?? theme.text], [entry.title, theme.text], [flagsOf(entry), theme.warn]]
}

export function entryRow(entry: AutoEntry, widths: number[]) {
  return <Cells cells={entryCells(entry)} columns={ENTRY_COLUMNS} widths={widths} />
}

// The flags a row carries: a bad header, no index line, or an index line past the load limit.
function flagsOf(entry: AutoEntry): string {
  if (!entry.frontmatterValid) return "▲ header is not valid YAML"
  if (entry.indexLine === null) return "▲ not in MEMORY.md, not loaded at start"
  if (entry.pastLoadLimit) return "▲ past the MEMORY.md load limit"
  return ""
}

// MEMORY.md carries the bar; lines and bytes are read again so the row follows the last write.
export function budgetRow(dir: string) {
  const path = join(dir, "MEMORY.md")
  if (!existsSync(path)) return <text fg={DIM} wrapMode="none">{"  MEMORY.md  no index yet"}</text>
  const text = readFileSync(path, "utf8")
  const lines = countLines(text)
  const [filled, empty] = bar(lines, INDEX_LINE_LIMIT)
  return (
    <text wrapMode="none">
      {"  MEMORY.md  "}
      <span fg={ACCENT}>{filled}</span>
      <span fg={theme.faint}>{empty}</span>
      <span fg={DIM}>{`  ${lines} of ${INDEX_LINE_LIMIT} lines · ${(Buffer.byteLength(text) / 1024).toFixed(1)} of ${INDEX_BYTE_LIMIT / 1024} KB`}</span>
    </text>
  )
}
