import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { countLines, INDEX_BYTE_LIMIT, INDEX_LINE_LIMIT } from "../memory/entry"
import { bar, pad, truncate } from "../memory/format"
import type { AutoEntry } from "../memory/types"
import { SHORT_CODES } from "./ItemList"
import { ACCENT, DIM, SELECTED_BG, theme } from "./theme"

const TYPE_COLOR: Record<string, string> = { feedback: theme.warn, reference: ACCENT, project: theme.ok, user: theme.text }
const WIDTHS = [12, 26, 17, 8] // TYPE, ENTRY, FLAGS, then LOADED BY takes the rest

interface MemoryEntriesProps {
  entries: AutoEntry[]
  dir: string
  selected: number // index into entries, or -1 when the selected row is an instruction file
}

// The AUTO MEMORY group under the instruction file groups, with the MEMORY.md budget bar as the footer.
export function MemoryEntries(props: MemoryEntriesProps) {
  return (
    <box flexDirection="column">
      <text fg={ACCENT} wrapMode="none">AUTO MEMORY</text>
      <text fg={DIM} wrapMode="none">{entryCells(["TYPE", "ENTRY", "FLAGS", "LOADED BY"])}</text>
      {props.entries.map((entry, index) => (
        <text key={entry.file} wrapMode="none" bg={index === props.selected ? SELECTED_BG : undefined}>
          {entryCells([entry.type ?? "-", entry.title, flagsOf(entry), SHORT_CODES["claude-code"]], index === props.selected)}
        </text>
      ))}
      <text wrapMode="none">{budgetLine(props.dir)}</text>
    </box>
  )
}

// The flags a row carries: a bad header, no index line, or an index line past the load limit.
function flagsOf(entry: AutoEntry): string {
  if (!entry.frontmatterValid) return "▲ yaml"
  if (entry.indexLine === null) return "▲ not in index"
  if (entry.pastLoadLimit) return "▲ past limit"
  return ""
}

// MEMORY.md carries the bar; lines and bytes are read again so the footer follows the last write.
function budgetLine(dir: string): string {
  const path = join(dir, "MEMORY.md")
  if (!existsSync(path)) return "MEMORY.md  no index yet"
  const text = readFileSync(path, "utf8")
  const lines = countLines(text)
  const [filled, empty] = bar(lines, INDEX_LINE_LIMIT)
  return `MEMORY.md  ${filled}${empty}  ${lines} / ${INDEX_LINE_LIMIT} lines · ${(Buffer.byteLength(text) / 1024).toFixed(1)} / ${INDEX_BYTE_LIMIT / 1024} KB`
}

// One row's cells; the type cell keeps its colour on the selected row, the rest turn white so they stay readable.
function entryCells(values: string[], isSelected = false) {
  const [type, entry, flags, loaded] = values
  return (
    <>
      <span fg={isSelected ? theme.selFg : (TYPE_COLOR[type!] ?? theme.text)}>{fitted(type!, 0)}</span>
      <span fg={isSelected ? theme.selFg : theme.text}>{fitted(entry!, 1)}</span>
      <span fg={isSelected ? theme.selFg : DIM}>{fitted(flags!, 2)}</span>
      <span fg={isSelected ? theme.selFg : DIM}>{loaded}</span>
    </>
  )
}

const fitted = (value: string, column: number) => pad(truncate(value, WIDTHS[column]!), WIDTHS[column]!)
