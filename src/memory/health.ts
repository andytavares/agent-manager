import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { INDEX_BYTE_LIMIT, INDEX_LINE_LIMIT, parseIndex } from "./entry"
import type { AutoEntry, HealthIssue, Source } from "./types"

const INSTRUCTION_KINDS = ["claude-md", "claude-local-md", "agents-md"]

export function knownNames(entries: AutoEntry[]): Set<string> {
  return new Set(entries.flatMap((e) => [e.name, e.file.slice(0, -3)]).flatMap((n) => [n, n.replaceAll("-", "_")]))
}

export const isBrokenLink = (known: Set<string>, link: string) => !known.has(link) && !known.has(link.replaceAll("-", "_"))

function entryIssues(entries: AutoEntry[]): HealthIssue[] {
  const known = knownNames(entries)
  return entries.flatMap((e) => [
    ...(e.indexLine === null ? [{ kind: "orphan", path: e.path, detail: "not listed in MEMORY.md" } as const] : []),
    ...(e.pastLoadLimit ? [{ kind: "past-limit", path: e.path, detail: `index line ${e.indexLine} is not loaded` } as const] : []),
    ...(e.frontmatterValid ? [] : [{ kind: "bad-frontmatter", path: e.path, detail: "frontmatter is missing or not valid YAML" } as const]),
    ...e.links
      .filter((l) => isBrokenLink(known, l))
      .map((l) => ({ kind: "broken-link", path: e.path, detail: `[[${l}]] has no matching entry` }) as const),
  ])
}

function deadIndexIssues(entries: AutoEntry[], memoryDir: string): HealthIssue[] {
  const indexPath = join(memoryDir, "MEMORY.md")
  if (!existsSync(indexPath)) return []
  return parseIndex(readFileSync(indexPath, "utf8"))
    .filter((row) => !entries.some((e) => e.file === row.file))
    .map((row) => ({ kind: "dead-index", path: indexPath, detail: `line ${row.line} points to missing ${row.file}` }))
}

function budgetIssues(sources: Source[]): HealthIssue[] {
  return sources
    .filter((s) => INSTRUCTION_KINDS.includes(s.kind) && s.lines > INDEX_LINE_LIMIT)
    .map((s) => ({ kind: "over-budget", path: s.path, detail: `${s.lines} lines, over ${INDEX_LINE_LIMIT}` }))
}

function indexBudgetIssues(memoryDir: string): HealthIssue[] {
  const indexPath = join(memoryDir, "MEMORY.md")
  if (!existsSync(indexPath)) return []
  const text = readFileSync(indexPath, "utf8")
  const lines = text.split("\n").length
  const bytes = Buffer.byteLength(text)
  if (lines <= INDEX_LINE_LIMIT && bytes <= INDEX_BYTE_LIMIT) return []
  return [{ kind: "over-budget", path: indexPath, detail: `${lines} lines, ${(bytes / 1024).toFixed(1)} KB; only the first ${INDEX_LINE_LIMIT} lines or 25 KB load` }]
}

// sources should hold every global and project source, so project CLAUDE.md files are checked too.
export function checkHealth(entries: AutoEntry[], memoryDir: string, sources: Source[]): HealthIssue[] {
  return [...entryIssues(entries), ...deadIndexIssues(entries, memoryDir), ...indexBudgetIssues(memoryDir), ...budgetIssues(sources)]
}
