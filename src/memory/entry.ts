import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"
import type { AutoEntry, IndexRow, Kind, Level, MemoryType, Source } from "./types"

export const INDEX_LINE_LIMIT = 200
export const INDEX_BYTE_LIMIT = 25_600
const MEMORY_TYPES: readonly string[] = ["user", "feedback", "project", "reference"]
const INDEX_LINE = /^- \[(.+?)\]\((.+?)\)\s*[—-]\s*(.*?)\r?$/
export const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?/
export const LINK_PATTERN = /\[\[([^\]]+)\]\]/g

type Meta = Record<string, any>

export const countLines = (text: string) => text.split("\n").filter((l, i, a) => i < a.length - 1 || l !== "").length
export const stripCode = (text: string) => text.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "")

export interface SourceSpec { level: Level; kind: Kind; path: string; loadsAtStart: boolean; readOnly?: boolean }

export function readSource(spec: SourceSpec): Source {
  const stat = statSync(spec.path)
  const lines = countLines(readFileSync(spec.path, "utf8"))
  return { readOnly: false, ...spec, lines, bytes: stat.size, mtimeMs: stat.mtimeMs }
}

// Claude writes unquoted values that contain ": ", which strict YAML rejects; fall back to key: value lines.
export function parseFrontmatter(text: string): { meta: Meta; valid: boolean } {
  try {
    const parsed = parseYaml(text)
    if (parsed && typeof parsed === "object") return { meta: parsed as Meta, valid: true }
  } catch {}
  const meta: Meta = { metadata: {} }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(\s*)([\w-]+):\s?(.*)$/)
    if (!m || (!m[1] && m[2] === "metadata")) continue
    ;(m[1] ? meta.metadata : meta)[m[2]!] = m[3]
  }
  return { meta, valid: false }
}

export function parseIndex(memoryMd: string): IndexRow[] {
  return memoryMd.split("\n").flatMap((text, i) => {
    const m = text.match(INDEX_LINE)
    return m ? [{ line: i + 1, title: m[1]!, file: m[2]!, hook: m[3]! }] : []
  })
}

function entryType(meta: Meta, file: string): MemoryType | null {
  const candidates = [meta.type, meta.metadata?.type, file.split("_")[0]]
  return (candidates.map(String).find((t) => MEMORY_TYPES.includes(t)) as MemoryType | undefined) ?? null
}

function isPastLimit(memoryMd: string, line: number): boolean {
  const upToLine = memoryMd.split("\n").slice(0, line).join("\n")
  return line > INDEX_LINE_LIMIT || Buffer.byteLength(upToLine) > INDEX_BYTE_LIMIT
}

interface EntryFile { meta: Meta; valid: boolean; raw: string; body: string }

function readEntryFile(path: string): EntryFile {
  const text = readFileSync(path, "utf8")
  const block = text.match(FRONTMATTER_PATTERN)
  if (!block) return { meta: {}, valid: false, raw: "", body: text }
  return { ...parseFrontmatter(block[1]!), raw: block[1]!, body: text.slice(block[0].length) }
}

const linksIn = (body: string) => [...stripCode(body).matchAll(LINK_PATTERN)].map((x) => x[1]!.trim())

function modifiedDate(meta: Meta): string | null {
  const modified = meta.metadata?.modified ?? meta.modified
  return modified ? String(modified).slice(0, 10) : null
}

interface EntryLocation { memoryDir: string; memoryMd: string; row: IndexRow | undefined }

function indexFields(location: EntryLocation, name: string) {
  const row = location.row
  if (!row) return { title: name, hook: "", indexLine: null, pastLoadLimit: false }
  return { title: row.title, hook: row.hook, indexLine: row.line, pastLoadLimit: isPastLimit(location.memoryMd, row.line) }
}

function loadEntry(file: string, location: EntryLocation): AutoEntry {
  const path = join(location.memoryDir, file)
  const { meta, valid, raw, body } = readEntryFile(path)
  const name = String(meta.name || file.slice(0, -3))
  return {
    ...readSource({ level: "project", kind: "auto-entry", path, loadsAtStart: false }),
    ...indexFields(location, name),
    file, name, description: String(meta.description ?? ""), type: entryType(meta, file),
    body, frontmatterRaw: raw, frontmatterValid: valid, links: linksIn(body), modified: modifiedDate(meta),
  }
}

export function loadEntries(memoryDir: string): AutoEntry[] {
  const indexPath = join(memoryDir, "MEMORY.md")
  const memoryMd = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : ""
  const rows = parseIndex(memoryMd)
  const files = readdirSync(memoryDir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md").sort()
  return files
    .map((file) => loadEntry(file, { memoryDir, memoryMd, row: rows.find((r) => r.file === file) }))
    .sort((a, b) => (a.indexLine ?? Infinity) - (b.indexLine ?? Infinity))
}

const entryStem = (entry: AutoEntry) => entry.file.slice(0, -3)

export function backlinks(entries: AutoEntry[], target: AutoEntry): AutoEntry[] {
  return entries.filter((e) => e.file !== target.file && (e.links.includes(target.name) || e.links.includes(entryStem(target))))
}
