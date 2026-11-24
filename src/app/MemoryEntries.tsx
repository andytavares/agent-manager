import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { countLines, INDEX_BYTE_LIMIT, INDEX_LINE_LIMIT } from "../memory/entry"
import { bar, pad } from "../memory/format"
import type { AutoEntry } from "../memory/types"
import { ACCENT, DIM, theme } from "./theme"

const TYPE_COLOR: Record<string, string> = { feedback: theme.warn, reference: ACCENT, project: theme.ok, user: theme.text }
const TYPE_WIDTH = 12
const ENTRY_WIDTH = 30

// One AUTO MEMORY row: type, title, then the first flag the entry carries.
export function entryRow(entry: AutoEntry, width: number) {
  const type = entry.type ?? "-"
  const flags = flagsOf(entry)
  return (
    <text wrapMode="none">
      {" "}
      <span fg={TYPE_COLOR[type] ?? theme.text}>{pad(type, TYPE_WIDTH)}</span>
      <span fg={theme.text}>{pad(entry.title, ENTRY_WIDTH)}</span>
      <span fg={theme.warn}>{flags.slice(0, Math.max(0, width - TYPE_WIDTH - ENTRY_WIDTH - 2))}</span>
    </text>
  )
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
