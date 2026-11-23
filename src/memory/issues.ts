import { existsSync } from "node:fs"
import { basename, join } from "node:path"
import { autoMemoryDir } from "../adapters/claude-code"
import type { HarnessAdapter, HarnessId, Item, McpServer, Roots } from "../core/model"
import { listItems, literalSecrets } from "../core/registry"
import { skillChecks } from "../core/skills"
import { loadEntries, readSource } from "./entry"
import { checkHealth } from "./health"
import type { HealthIssue, Level, Source } from "./types"

export type IssueKind = HealthIssue["kind"] | "skill" | "mcp-secret"
export interface Issue {
  kind: IssueKind
  path: string
  detail: string
}

const LEVELS: Record<Item["scope"], Level> = { global: "global", project: "project", local: "project" }

// The instructions health.ts checks for size, named as it expects.
function sourceKind(item: Item): Source["kind"] {
  const name = basename(item.path)
  if (name === "MEMORY.md") return "auto-index"
  if (name === "CLAUDE.local.md") return "claude-local-md"
  if (name === "AGENTS.md") return "agents-md"
  if (name === "CLAUDE.md") return "claude-md"
  return "rule"
}

function memoryIssues(entries: Parameters<typeof checkHealth>[0], dir: string, items: Item[]): Issue[] {
  const sources = items.map((item) => readSource({ level: LEVELS[item.scope], kind: sourceKind(item), path: item.path, loadsAtStart: true }))
  return checkHealth(entries, dir, sources)
}

function skillIssues(adapters: HarnessAdapter[], skills: Item[]): Promise<Issue[]> {
  return Promise.all(
    skills.map(async (item): Promise<Issue[]> => {
      const detail = await adapters.find((adapter) => adapter.id === item.harness)?.read(item)
      if (detail?.type !== "text") return []
      const path = join(item.path, "SKILL.md")
      const harnesses: HarnessId[] = [...item.loadedBy, ...(item.offIn ?? [])]
      return harnesses.flatMap((harness) => skillChecks(harness, basename(item.path), detail.text).map((check) => ({ kind: "skill" as const, path, detail: check })))
    }),
  ).then((lists) => lists.flat())
}

// The variable names of the literal values, so the message names the variable to replace.
function secretNames(server: McpServer): string[] {
  const literal = new Set(literalSecrets(server))
  return Object.entries({ ...server.env, ...server.headers })
    .filter(([, value]) => literal.has(value))
    .map(([name]) => name)
}

function secretIssues(adapters: HarnessAdapter[], servers: Item[]): Promise<Issue[]> {
  return Promise.all(
    servers.map(async (item): Promise<Issue[]> => {
      const detail = await adapters.find((adapter) => adapter.id === item.harness)?.read(item)
      if (detail?.type !== "mcp") return []
      return secretNames(detail.server).map((name) => ({ kind: "mcp-secret" as const, path: item.path, detail: `${name} is a literal value, use \${VAR}` }))
    }),
  ).then((lists) => lists.flat())
}

// Memory issues first, then skill issues, then MCP secrets, each in listing order.
export async function healthIssues(adapters: HarnessAdapter[], roots: Roots): Promise<Issue[]> {
  const [memory, skills, servers] = await Promise.all([
    listItems(adapters, "memory", roots),
    listItems(adapters, "skill", roots),
    listItems(adapters, "mcp", roots),
  ])
  const dir = await autoMemoryDir(roots)
  const entries = existsSync(dir) ? loadEntries(dir) : []
  return [...memoryIssues(entries, dir, memory), ...(await skillIssues(adapters, skills)), ...(await secretIssues(adapters, servers))]
}
