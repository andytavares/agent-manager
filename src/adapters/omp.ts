import { existsSync, readdirSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { basename, dirname, join, parse as parsePath, relative } from "node:path"
import { applyEdits, modify, parse as parseJsonc, type JSONPath, type ParseError } from "jsonc-parser"
import { parse as parseYaml } from "yaml"
import type { Change, HarnessAdapter, HarnessId, Item, Kind, McpServer, Roots, Scope, WritePlan } from "../core/model"
import { emptyPlan, planMemoryFile } from "../core/memory-plan"
import { listSkillFolders } from "../core/skills"

// omp (oh-my-pi). Paths and rules: https://github.com/can1357/oh-my-pi/tree/main/docs
type Settings = Record<string, unknown>
type Level = "user" | "project"

interface Context {
  roots: Roots
  agentDir: string
  settings: Settings
}

// A candidate file or folder, the discovery provider that loads it, and the level its rules use.
interface Source {
  scope: Scope
  path: string
  provider: string
  level: Level
  allowed?: boolean // false when a setting other than the provider rule turns it off
}

// Foreign user-level providers load only when enabledProviders names them (context-files.md).
const OPT_IN_USER_PROVIDERS = new Set(["claude", "codex", "gemini", "opencode", "github"])
const MCP_IMPORTS: [string, HarnessId][] = [
  ["claude", "claude-code"],
  ["codex", "codex"],
  ["opencode", "opencode"],
]

function agentDir({ home, env }: Roots): string {
  const profile = env.OMP_PROFILE?.trim()
  // A named profile ignores PI_CODING_AGENT_DIR (config-usage.md, Profiles).
  if (profile && profile !== "default") return join(home, ".omp/profiles", profile, "agent")
  return env.PI_CODING_AGENT_DIR ?? join(home, ".omp/agent")
}

function claudeHome({ home, env }: Roots): string {
  return env.CLAUDE_CONFIG_DIR ?? join(home, ".claude")
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}

async function readJsonc(path: string): Promise<Record<string, unknown>> {
  const text = await readText(path)
  if (text === null) return {}
  const errors: ParseError[] = []
  const data: unknown = parseJsonc(text, errors)
  return errors.length ? {} : asRecord(data)
}

// config.yml falls back to config.yaml when absent.
async function readYamlConfig(dir: string): Promise<Settings> {
  const yml = join(dir, "config.yml")
  const text = await readText(existsSync(yml) ? yml : join(dir, "config.yaml"))
  if (text === null) return {}
  try {
    return asRecord(parseYaml(text))
  } catch {
    return {}
  }
}

// Nested objects merge; arrays and scalars from the later layer replace earlier ones.
function mergeSettings(base: Settings, layer: Settings): Settings {
  const merged = { ...base }
  for (const [key, value] of Object.entries(layer)) {
    const previous = merged[key]
    const bothObjects = Object.keys(asRecord(previous)).length && Object.keys(asRecord(value)).length
    merged[key] = bothObjects ? mergeSettings(asRecord(previous), asRecord(value)) : value
  }
  return merged
}

// Global config.yml, then project settings.json, then project config.yml (config-usage.md §4).
async function loadContext(roots: Roots): Promise<Context> {
  const dir = agentDir(roots)
  const projectDir = join(roots.project, ".omp")
  const layers = [await readYamlConfig(dir), await readJsonc(join(projectDir, "settings.json")), await readYamlConfig(projectDir)]
  return { roots, agentDir: dir, settings: layers.reduce(mergeSettings) }
}

function providerOn(ctx: Context, provider: string, level: Level): boolean {
  const { settings, roots } = ctx
  if (strings(settings.disabledProviders).includes(provider)) return false
  if (level === "project" || !OPT_IN_USER_PROVIDERS.has(provider)) return true
  const enabled = strings(settings.enabledProviders)
  const claudeOptIn = provider === "claude" && roots.env.CLAUDE_CONFIG_DIR !== undefined
  return claudeOptIn || ["*", "all", provider].some((id) => enabled.includes(id))
}

// An off item has offIn ["omp"] and an empty loadedBy, never both (model.ts).
function toItem(ctx: Context, kind: Kind, entry: Source & { name: string; key?: string }): Item {
  const on = entry.allowed !== false && providerOn(ctx, entry.provider, entry.level)
  return {
    kind,
    harness: "omp",
    scope: entry.scope,
    name: entry.name,
    path: entry.path,
    ...(entry.key && { key: entry.key }),
    loadedBy: on ? ["omp"] : [],
    ...(!on && { offIn: ["omp" as const] }),
  }
}

// from, its parent, and so on, ending at stop (or the filesystem root).
function ancestors(from: string, stop: string): string[] {
  const dirs = [from]
  for (let dir = from; dir !== stop && dirname(dir) !== dir; ) {
    dir = dirname(dir)
    dirs.push(dir)
  }
  return dirs
}

function repoRoot(project: string): string {
  return ancestors(project, parsePath(project).root).find((dir) => existsSync(join(dir, ".git"))) ?? project
}

function isNonEmptyDir(path: string): boolean {
  try {
    return readdirSync(path).length > 0
  } catch {
    return false
  }
}

// AGENTS.md and RULES.md in the agent dir and in the nearest non-empty .omp toward the repo root.
function nativeMemorySources({ roots, agentDir }: Context): Source[] {
  const nearestOmp = ancestors(roots.project, repoRoot(roots.project))
    .map((dir) => join(dir, ".omp"))
    .find(isNonEmptyDir)
  const native = (scope: Scope, dir: string, level: Level): Source[] =>
    ["AGENTS.md", "RULES.md"].map((file) => ({ scope, path: join(dir, file), provider: "native", level }))
  return [...native("global", agentDir, "user"), ...(nearestOmp ? native("project", nearestOmp, "project") : [])]
}

function memorySources(ctx: Context): Source[] {
  const { roots } = ctx
  const walk = ancestors(roots.project, repoRoot(roots.project))
  return [
    ...nativeMemorySources(ctx),
    { scope: "global", path: join(claudeHome(roots), "CLAUDE.md"), provider: "claude", level: "user" },
    { scope: "project", path: join(roots.project, ".claude/CLAUDE.md"), provider: "claude", level: "project" },
    ...walk.flatMap((dir): Source[] => [
      { scope: "project", path: join(dir, "CLAUDE.md"), provider: "claude-md", level: "project" },
      { scope: "project", path: join(dir, "AGENTS.md"), provider: "agents-md", level: "project" },
    ]),
  ]
}

// The local memory backend writes per-project files under <agentDir>/memories/<encoded cwd>/:
// https://github.com/can1357/oh-my-pi/blob/f4c5a138c119364668fba67b7f4437faf56b4324/packages/coding-agent/src/memories/index.ts#L1407-L1409
// https://github.com/can1357/oh-my-pi/blob/f4c5a138c119364668fba67b7f4437faf56b4324/packages/coding-agent/src/memories/index.ts#L1549-L1551
// shortcut: ignores the $XDG_STATE_HOME/omp root omp uses after `omp config init-xdg`; add it when a user needs it.
function backendMemoryItems(ctx: Context): Item[] {
  const encoded = `--${ctx.roots.project.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`
  const root = join(ctx.agentDir, "memories", encoded)
  const allowed = asRecord(ctx.settings.memory).backend === "local"
  return ["MEMORY.md", "memory_summary.md", "learned.md"]
    .map((name) => join(root, name))
    .filter((path) => existsSync(path))
    .map((path) => ({
      ...toItem(ctx, "memory", { scope: "project", path, provider: "native", level: "project", allowed, name: basename(path) }),
      warnings: ["omp memory backend file"],
    }))
}

function listMemory(ctx: Context): Item[] {
  const files = memorySources(ctx)
    .filter((source) => existsSync(source.path))
    .map((source) => {
      const name = source.scope === "global" ? basename(source.path) : relative(ctx.roots.project, source.path)
      return toItem(ctx, "memory", { ...source, name })
    })
  return [...files, ...backendMemoryItems(ctx)]
}

const MEMORY_FILES: Partial<Record<Scope, string[]>> = { global: ["AGENTS.md", "RULES.md"], project: ["AGENTS.md", "RULES.md"] }

const planMemory = (change: Change, roots: Roots) =>
  planMemoryFile(change, { label: "omp", scopeRoot: (scope) => (scope === "global" ? agentDir(roots) : join(roots.project, ".omp")), memoryFiles: MEMORY_FILES })

// User mcp.json disabledServers/enabledServers apply to servers from every source (mcp-config.md).
async function listMcp(ctx: Context): Promise<Item[]> {
  const userFile = join(ctx.agentDir, "mcp.json")
  const user = await readJsonc(userFile)
  const disabled = new Set(strings(user.disabledServers))
  const forced = new Set(strings(user.enabledServers))
  const projectFile = join(ctx.roots.project, ".omp/mcp.json")
  const projectAllowed = asRecord(ctx.settings.mcp).enableProjectConfig !== false
  const files: [Source, Record<string, unknown>][] = [
    [{ scope: "global", path: userFile, provider: "native", level: "user" }, user],
    [{ scope: "project", path: projectFile, provider: "native", level: "project", allowed: projectAllowed }, await readJsonc(projectFile)],
  ]
  return files.flatMap(([source, data]) =>
    Object.entries(asRecord(data.mcpServers)).map(([name, server]) => {
      const off = disabled.has(name) || (asRecord(server).enabled === false && !forced.has(name))
      const allowed = source.allowed !== false && !off
      return toItem(ctx, "mcp", { ...source, allowed, name, key: `mcpServers.${name}` })
    }),
  )
}

function skillSources({ roots, agentDir, settings }: Context): Source[] {
  const toggles = asRecord(settings.skills)
  const toggle = (name: string) => toggles[name] !== false
  const projectOmpSkills = ancestors(roots.project, repoRoot(roots.project)).map((dir): Source => ({
    scope: "project",
    path: join(dir, ".omp/skills"),
    provider: "native",
    level: "project",
    allowed: toggle("enablePiProject"),
  }))
  return [
    { scope: "global", path: join(agentDir, "skills"), provider: "native", level: "user", allowed: toggle("enablePiUser") },
    { scope: "global", path: join(agentDir, "managed-skills"), provider: "omp-managed", level: "user" },
    ...projectOmpSkills,
    { scope: "global", path: join(claudeHome(roots), "skills"), provider: "claude", level: "user", allowed: toggle("enableClaudeUser") },
    { scope: "global", path: join(roots.home, ".agents/skills"), provider: "agents", level: "user", allowed: toggle("enableAgentsUser") },
    { scope: "project", path: join(roots.project, ".claude/skills"), provider: "claude", level: "project", allowed: toggle("enableClaudeProject") },
    { scope: "project", path: join(roots.project, ".agents/skills"), provider: "agents", level: "project", allowed: toggle("enableAgentsProject") },
  ]
}

// skills.ignoredSkills and skills.includeSkills hold glob patterns (skills.md).
function skillNameAllowed(settings: Settings, name: string): boolean {
  const skills = asRecord(settings.skills)
  const matches = (patterns: string[]) => patterns.some((pattern) => new Bun.Glob(pattern).match(name))
  const include = strings(skills.includeSkills)
  return !matches(strings(skills.ignoredSkills)) && (include.length === 0 || matches(include))
}

async function listSkills(ctx: Context): Promise<Item[]> {
  const perRoot = await Promise.all(
    skillSources(ctx).map(async (source) =>
      (await listSkillFolders(source.path)).map((folder) => {
        const allowed = source.allowed !== false && skillNameAllowed(ctx.settings, folder.name)
        return toItem(ctx, "skill", { ...source, path: folder.path, allowed, name: folder.name })
      }),
    ),
  )
  return perRoot.flat()
}

// Marketplace installs live in installed_plugins.json; npm/git/link installs in package.json dependencies,
// with enabled state in omp-plugins.lock.json (plugin-manager-installer-plumbing.md).
async function listPluginRoot(ctx: Context, scope: Scope, masked: Set<string>): Promise<Item[]> {
  const level: Level = scope === "global" ? "user" : "project"
  const root = join(scope === "global" ? ctx.roots.home : ctx.roots.project, ".omp/plugins")
  const installed = join(root, "installed_plugins.json")
  const manifest = join(root, "package.json")
  const lock = asRecord((await readJsonc(join(root, "omp-plugins.lock.json"))).plugins)
  const marketplace = Object.keys(asRecord((await readJsonc(installed)).plugins)).map((name) =>
    toItem(ctx, "plugin", { scope, path: installed, provider: "native", level, allowed: !masked.has(name), name, key: `plugins.${name}` }),
  )
  const npm = Object.keys(asRecord((await readJsonc(manifest)).dependencies)).map((name) => {
    const allowed = asRecord(lock[name]).enabled !== false && !masked.has(name)
    return toItem(ctx, "plugin", { scope, path: manifest, provider: "native", level, allowed, name, key: `dependencies.${name}` })
  })
  return [...marketplace, ...npm]
}

async function listPlugins(ctx: Context): Promise<Item[]> {
  const overrides = await readJsonc(join(ctx.roots.project, ".omp/plugin-overrides.json"))
  const masked = new Set(strings(overrides.disabled))
  return [
    ...(await listPluginRoot(ctx, "global", masked)),
    ...(await listPluginRoot(ctx, "project", masked)),
  ]
}

async function readMcp(item: Item): Promise<McpServer> {
  const servers = asRecord((await readJsonc(item.path)).mcpServers)
  const { type, command, args, env, url, headers, enabled: _enabled, ...native } = asRecord(servers[item.name])
  // Discovery infers http for a URL-only entry (mcp-config.md).
  const transport = (type ?? (url !== undefined && command === undefined ? "http" : "stdio")) as McpServer["transport"]
  return {
    name: item.name,
    transport,
    enabled: !item.offIn?.includes("omp"),
    ...(command !== undefined && { command: command as string }),
    ...(args !== undefined && { args: args as string[] }),
    ...(env !== undefined && { env: env as Record<string, string> }),
    ...(url !== undefined && { url: url as string }),
    ...(headers !== undefined && { headers: headers as Record<string, string> }),
    native,
  }
}

function toEntry(server: McpServer): Record<string, unknown> {
  const { type: _type, command: _command, url: _url, enabled: _enabled, ...native } = server.native
  const entry: Record<string, unknown> =
    server.transport === "stdio"
      ? { ...native, command: server.command, args: server.args, env: server.env }
      : { ...native, type: server.transport, url: server.url, headers: server.headers }
  if (!server.enabled) entry.enabled = false
  return JSON.parse(JSON.stringify(entry)) // drops undefined fields
}

const FORMAT = { formattingOptions: { tabSize: 2, insertSpaces: true } }
const setJsonc = (text: string, path: JSONPath, value: unknown) => applyEdits(text, modify(text, path, value, FORMAT))
const hasEnvRef = (server: McpServer) => Object.values({ ...server.env, ...server.headers }).some((value) => value.includes("${"))

async function planMcp(change: Change, roots: Roots): Promise<WritePlan> {
  const item = change.item
  if (item?.readOnly) throw new Error(`omp: ${item.name} is read-only (${item.readOnly})`)
  const path = item?.path ?? (change.target.scope === "global" ? join(agentDir(roots), "mcp.json") : join(roots.project, ".omp/mcp.json"))
  const before = await readText(path)
  let after = before ?? "{}\n"
  if (item) after = setJsonc(after, ["mcpServers", item.name], undefined)
  const notices = ["Restart omp to load this change."]
  if (change.op !== "delete") {
    const server = change.server!
    const taken = server.name in asRecord((await readJsonc(path)).mcpServers)
    if (taken && server.name !== item?.name) throw new Error(`omp: ${server.name} already exists in ${path}`)
    after = setJsonc(after, ["mcpServers", server.name], toEntry(server))
    if (hasEnvRef(server)) notices.push("omp may not expand ${VAR} in mcp.json; check the server starts.")
  }
  return { ...emptyPlan(), edits: [{ path, before, after }], notices }
}

async function readPlugin(item: Item) {
  const data = await readJsonc(item.path)
  const enabled = !item.offIn?.includes("omp")
  if (item.key?.startsWith("plugins.")) {
    const [entry] = Array.isArray(asRecord(data.plugins)[item.name]) ? (asRecord(data.plugins)[item.name] as unknown[]) : []
    const version = asRecord(entry).version
    return { name: item.name, enabled, ...(typeof version === "string" && { version }), source: item.name.split("@").at(-1) }
  }
  const spec = asRecord(data.dependencies)[item.name]
  return { name: item.name, enabled, ...(typeof spec === "string" && { version: spec }), source: "npm" }
}

export const omp: HarnessAdapter = {
  id: "omp",
  label: "omp",
  scopes: ["global", "project"],
  memoryFiles: MEMORY_FILES,

  async detect(roots) {
    return existsSync(agentDir(roots))
  },

  async plan(change, roots) {
    if (change.kind === "mcp") return planMcp(change, roots)
    if (change.kind !== "memory") throw new Error(`omp: ${change.kind} changes are not supported yet`)
    return planMemory(change, roots)
  },

  async skillRoots(roots) {
    const ctx = await loadContext(roots)
    return skillSources(ctx)
      .filter((source) => source.allowed !== false && providerOn(ctx, source.provider, source.level))
      .map(({ path, scope }) => ({ path, scope }))
  },

  async list(kind, roots) {
    const ctx = await loadContext(roots)
    if (kind === "memory") return listMemory(ctx)
    if (kind === "mcp") return listMcp(ctx)
    if (kind === "skill") return listSkills(ctx)
    return listPlugins(ctx)
  },

  async read(item) {
    if (item.kind === "mcp") return { type: "mcp", server: await readMcp(item) }
    if (item.kind === "plugin") return { type: "plugin", plugin: await readPlugin(item) }
    const path = item.kind === "skill" ? join(item.path, "SKILL.md") : item.path
    return { type: "text", text: (await readText(path)) ?? "" }
  },

  async importsMcpFrom(roots) {
    const ctx = await loadContext(roots)
    const projectAllowed = asRecord(ctx.settings.mcp).enableProjectConfig !== false
    return MCP_IMPORTS.flatMap(([provider, harness]) => {
      const project = projectAllowed && providerOn(ctx, provider, "project")
      const projectScopes: Scope[] = harness === "claude-code" ? ["project", "local"] : ["project"]
      return [
        ...(project ? projectScopes : []),
        ...(providerOn(ctx, provider, "user") ? (["global"] as Scope[]) : []),
      ].map((scope) => ({ harness, scope }))
    })
  },
}
