import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

// One tool call or slash command in a Claude Code transcript, with the project folder's transcript dir.
export interface Use {
  key: string
  folder: string
  date: string
}
export interface Usage {
  here: number
  all: number
  last: string | null
}

type Json = Record<string, any>

const COMMAND = /<command-name>\/([^<\s]+)<\/command-name>/

// Claude Code builds an MCP tool name from the server name this way.
const toolKey = (name: string) => name.replace(/[^A-Za-z0-9_-]/g, "_")

function blockKeys(block: Json): string[] {
  const name = String(block.name)
  if (name.startsWith("mcp__")) return [`mcp:${name.split("__")[1]}`]
  if (name === "Skill") return [`command:${block.input?.skill}`]
  if (name === "Agent" || name === "Task") return [`command:${block.input?.subagent_type}`]
  return []
}

function recordKeys(record: Json): string[] {
  const content = record.message?.content
  if (typeof content === "string") return content.match(COMMAND) ? [`command:${content.match(COMMAND)![1]}`] : []
  return Array.isArray(content) ? content.filter((block) => block?.type === "tool_use").flatMap(blockKeys) : []
}

function fileUses(path: string, folder: string): Use[] {
  const uses: Use[] = []
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.includes('"tool_use"') && !line.includes("<command-name>")) continue
    let record: Json
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    const date = String(record.timestamp ?? "").slice(0, 10)
    for (const key of recordKeys(record)) uses.push({ key, folder, date })
  }
  return uses
}

// Every transcript under the config's projects folder, as paths relative to it.
const transcripts = (config: string) => {
  const projectsDir = join(config, "projects")
  return existsSync(projectsDir) ? readdirSync(projectsDir, { recursive: true }).map(String).filter((file) => file.endsWith(".jsonl")) : []
}

export function readUses(config: string): Use[] {
  const projectsDir = join(config, "projects")
  return transcripts(config).flatMap((file) => fileUses(join(projectsDir, file), file.split("/")[0]!))
}

// Claude Code deletes old transcripts (cleanupPeriodDays), so usage only covers the days since the oldest one.
export function transcriptsSince(config: string): string | null {
  const projectsDir = join(config, "projects")
  const times = transcripts(config).map((file) => statSync(join(projectsDir, file)).mtimeMs)
  return times.length ? new Date(Math.min(...times)).toISOString().slice(0, 10) : null
}

function usageOf(keyOf: (use: Use) => boolean, uses: Use[], folders: string[]): Usage {
  const mine = uses.filter(keyOf)
  return {
    here: mine.filter((use) => folders.includes(use.folder)).length,
    all: mine.length,
    last: mine.map((use) => use.date).filter(Boolean).sort().pop() ?? null,
  }
}

export function mcpUsage(name: string, uses: Use[], folders: string[]): Usage {
  return usageOf((use) => use.key === `mcp:${toolKey(name)}`, uses, folders)
}

// A plugin skill is called <plugin>:<folder name>; a user skill is called by its folder name.
export function skillUsage(name: string, uses: Use[], folders: string[]): Usage {
  return usageOf((use) => use.key === `command:${name}` || use.key.endsWith(`:${name}`), uses, folders)
}

export function sinceNote(since: string | null): string {
  return since ? `here / all count Claude Code transcripts since ${since}.` : "here / all count Claude Code transcripts; none were found."
}
