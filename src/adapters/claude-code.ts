import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"
import { parse, type ParseError } from "jsonc-parser"
import {
  HARNESS_LABELS,
  type Change,
  type HarnessAdapter,
  type Item,
  type Kind,
  type McpServer,
  type Roots,
  type Scope,
  type WritePlan,
} from "../core/model"
import { emptyPlan, memoryPattern, planMemoryFile } from "../core/memory-plan"
import { listSkillFolders, parseFrontmatter } from "../core/skills"

type Json = Record<string, any>

const ID = "claude-code"
const LABEL = HARNESS_LABELS[ID]
const OFF = { loadedBy: [], offIn: [ID] } satisfies Partial<Item>
const WS_READ_ONLY = "ws transport: edit with claude mcp add-json"
const TRANSPORTS: Record<string, McpServer["transport"]> = {
  stdio: "stdio",
  http: "http",
  sse: "sse",
  "streamable-http": "http",
  ws: "http",
}
const PLUGIN_SCOPES: Record<string, Scope> = { user: "global", project: "project", local: "local" }

function configPaths(roots: Roots) {
  const override = roots.env.CLAUDE_CONFIG_DIR
  const configDir = override ?? join(roots.home, ".claude")
  return { configDir, claudeJson: override ? join(configDir, ".claude.json") : join(roots.home, ".claude.json") }
}

// A missing or unparsable file gives undefined, so one bad file never stops the listing.
async function readJson(path: string): Promise<Json | undefined> {
  if (!existsSync(path)) return undefined
  const errors: ParseError[] = []
  const value = parse(await readFile(path, "utf8"), errors, { allowTrailingComma: true })
  return errors.length === 0 && value && typeof value === "object" ? value : undefined
}

function item(kind: Kind, scope: Scope, name: string, path: string, extra: Partial<Item> = {}): Item {
  return { kind, harness: ID, scope, name, path, loadedBy: [ID], ...extra }
}

// Paths of *.md files under root/subdir, relative to root.
async function markdownFiles(root: string, subdir: string): Promise<string[]> {
  const dir = join(root, subdir)
  if (!existsSync(dir)) return []
  const entries = await readdir(dir, { recursive: true })
  return entries.filter((entry) => entry.endsWith(".md")).sort().map((entry) => join(subdir, entry))
}

function existingFiles(root: string, names: string[], fields: Partial<Item> & { scope: Scope }): Item[] {
  return names
    .filter((name) => existsSync(join(root, name)))
    .map((name) => item("memory", fields.scope, name, join(root, name), fields))
}

function autoMemoryDir(roots: Roots, configDir: string, settings: Json): string {
  const custom = settings.autoMemoryDirectory
  return typeof custom === "string"
    ? custom.replace(/^~(?=\/|$)/, roots.home)
    : join(configDir, "projects", roots.project.replace(/[/.]/g, "-"), "memory")
}

async function autoMemory(roots: Roots, configDir: string, settings: Json): Promise<Item[]> {
  const dir = autoMemoryDir(roots, configDir, settings)
  const state = settings.autoMemoryEnabled === false ? OFF : {}
  return existingFiles(dir, await markdownFiles(dir, ""), { scope: "project", ...state })
}

async function listMemory(roots: Roots): Promise<Item[]> {
  const { configDir } = configPaths(roots)
  const settings = (await readJson(join(configDir, "settings.json"))) ?? {}
  const project = roots.project
  const projectFiles = ["CLAUDE.md", ".claude/CLAUDE.md"]
  const hasClaudeFile = [...projectFiles, "CLAUDE.local.md"].some((name) => existsSync(join(project, name)))
  return [
    ...existingFiles(configDir, ["CLAUDE.md", ...(await markdownFiles(configDir, "rules"))], { scope: "global" }),
    ...existingFiles(project, [...projectFiles, ...(await markdownFiles(project, ".claude/rules"))], { scope: "project" }),
    ...existingFiles(project, ["CLAUDE.local.md"], { scope: "local" }),
    ...(hasClaudeFile ? [] : existingFiles(project, ["AGENTS.md"], { scope: "project" })),
    ...(await autoMemory(roots, configDir, settings)),
  ]
}

function settingsFiles(roots: Roots, configDir: string): string[] {
  return [
    join(configDir, "settings.json"),
    join(roots.project, ".claude/settings.json"),
    join(roots.project, ".claude/settings.local.json"),
  ]
}

function serverItems(servers: unknown, keyPrefix: string, location: Pick<Item, "scope" | "path">): Item[] {
  return Object.entries((servers ?? {}) as Json).map(([name, config]) =>
    item("mcp", location.scope, name, location.path, {
      key: `${keyPrefix}.${name}`,
      ...(config?.type === "ws" && { readOnly: WS_READ_ONLY }),
    }),
  )
}

async function listMcp(roots: Roots): Promise<Item[]> {
  const { configDir, claudeJson } = configPaths(roots)
  const user = await readJson(claudeJson)
  const mcpJson = join(roots.project, ".mcp.json")
  const settings = await Promise.all(settingsFiles(roots, configDir).map(readJson))
  const disabled = settings.flatMap((file) => file?.disabledMcpjsonServers ?? [])
  return [
    ...serverItems(user?.mcpServers, "mcpServers", { scope: "global", path: claudeJson }),
    ...serverItems(user?.projects?.[roots.project]?.mcpServers, `projects["${roots.project}"].mcpServers`, {
      scope: "local",
      path: claudeJson,
    }),
    ...serverItems((await readJson(mcpJson))?.mcpServers, "mcpServers", { scope: "project", path: mcpJson }).map(
      (server) => (disabled.includes(server.name) ? { ...server, ...OFF } : server),
    ),
  ]
}

async function readServer(item: Item): Promise<McpServer> {
  const file = (await readJson(item.path)) ?? {}
  const project = item.scope === "local" ? item.key!.slice('projects["'.length, item.key!.lastIndexOf('"].mcpServers')) : undefined
  const servers = project === undefined ? file.mcpServers : file.projects?.[project]?.mcpServers
  const { type, command, args, env, url, headers, ...native } = (servers?.[item.name] ?? {}) as Json
  if (type === "ws") native.type = type
  const transport = TRANSPORTS[type ?? "stdio"] ?? "stdio"
  const enabled = !item.offIn?.includes(ID)
  return { name: item.name, transport, enabled, command, args, env, url, headers, native }
}

interface PluginRecord {
  id: string
  scope: Scope
  installPath: string
  version?: string
}

function installedPluginsPath(roots: Roots): string {
  return join(configPaths(roots).configDir, "plugins/installed_plugins.json")
}

// Project and local installs apply only to the project they were installed in.
async function installedPlugins(roots: Roots): Promise<PluginRecord[]> {
  const plugins = (await readJson(installedPluginsPath(roots)))?.plugins ?? {}
  return Object.entries(plugins as Record<string, Json[]>).flatMap(([id, records]) =>
    records
      .filter((record) => PLUGIN_SCOPES[record.scope] && (record.scope === "user" || record.projectPath === roots.project))
      .map((record) => ({ id, scope: PLUGIN_SCOPES[record.scope]!, installPath: record.installPath, version: record.version })),
  )
}

async function listSkills(roots: Roots): Promise<Item[]> {
  const { configDir } = configPaths(roots)
  const skillItems = async (root: string, scope: Scope, extra?: Partial<Item>) =>
    (await listSkillFolders(root)).map((skill) => item("skill", scope, skill.name, skill.path, extra))
  const plugins = await installedPlugins(roots)
  const pluginSkills = plugins.map((plugin) =>
    skillItems(join(plugin.installPath, "skills"), "global", { readOnly: `from plugin ${plugin.id}` }),
  )
  return [
    ...(await skillItems(join(configDir, "skills"), "global")),
    ...(await skillItems(join(roots.project, ".claude/skills"), "project")),
    ...(await Promise.all(pluginSkills)).flat(),
  ]
}

async function listPlugins(roots: Roots): Promise<Item[]> {
  const settings = await Promise.all(settingsFiles(roots, configPaths(roots).configDir).map(readJson))
  // Later files win: user < project < local.
  const enabled: Json = Object.assign({}, ...settings.map((file) => file?.enabledPlugins))
  const path = installedPluginsPath(roots)
  return (await installedPlugins(roots)).map((plugin) =>
    item("plugin", plugin.scope, plugin.id, path, { key: plugin.id, ...(enabled[plugin.id] !== true && OFF) }),
  )
}

async function readPlugin(item: Item) {
  const records = ((await readJson(item.path))?.plugins?.[item.name] ?? []) as Json[]
  const record = records.find((candidate) => PLUGIN_SCOPES[candidate.scope] === item.scope)
  const source = item.name.slice(item.name.lastIndexOf("@") + 1)
  return { name: item.name, enabled: !item.offIn?.includes(ID), version: record?.version, source }
}

const MEMORY_FILES: Record<Scope, string[]> = {
  global: ["CLAUDE.md", "rules/<name>.md"],
  project: ["CLAUDE.md", ".claude/CLAUDE.md", ".claude/rules/<name>.md", "AGENTS.md", "memory/<name>.md"],
  local: ["CLAUDE.local.md"],
}
const AUTO_MEMORY_ENTRY = "memory/<name>.md"

const readText = async (path: string) => (existsSync(path) ? readFile(path, "utf8") : null)

function memoryIndexLine(fileName: string, text: string): string {
  const { data } = parseFrontmatter(text)
  const title = typeof data.name === "string" ? data.name : fileName.replace(/\.md$/, "")
  return `- [${title}](${fileName})${typeof data.description === "string" ? ` — ${data.description}` : ""}`
}

// An auto memory entry also gets a line in MEMORY.md.
async function planAutoEntry(change: Change, autoDir: string): Promise<WritePlan> {
  const path = join(autoDir, change.name!.slice("memory/".length))
  if (existsSync(path)) throw new Error(`${LABEL}: ${path} already exists`)
  const text = change.text ?? ""
  const indexPath = join(autoDir, "MEMORY.md")
  const before = await readText(indexPath)
  const head = before && !before.endsWith("\n") ? `${before}\n` : (before ?? "")
  const index = { path: indexPath, before, after: `${head}${memoryIndexLine(relative(autoDir, path), text)}\n` }
  return { ...emptyPlan(), edits: [{ path, before: null, after: text }, index] }
}

// Deleting an auto memory entry also removes its MEMORY.md line.
async function planAutoDelete(item: Item, autoDir: string): Promise<WritePlan> {
  const plan: WritePlan = { ...emptyPlan(), removals: [item.path] }
  const indexPath = join(autoDir, "MEMORY.md")
  const before = await readText(indexPath)
  if (before === null) return plan
  const link = `(${relative(autoDir, item.path)})`
  const after = before
    .split("\n")
    .filter((line) => !line.includes(link))
    .join("\n")
  if (after !== before) plan.edits.push({ path: indexPath, before, after })
  return plan
}

async function plan(change: Change, roots: Roots): Promise<WritePlan> {
  if (change.kind !== "memory") throw new Error(`${LABEL}: ${change.kind} changes are not supported yet`)
  const { configDir } = configPaths(roots)
  const autoDir = autoMemoryDir(roots, configDir, (await readJson(join(configDir, "settings.json"))) ?? {})
  const item = change.item
  const isAutoEntry = item && !item.readOnly && item.path.startsWith(`${autoDir}/`) && item.path !== join(autoDir, "MEMORY.md")
  if (change.op === "create" && change.target.scope === "project" && memoryPattern(AUTO_MEMORY_ENTRY).test(change.name ?? "")) return planAutoEntry(change, autoDir)
  if (change.op === "delete" && isAutoEntry) return planAutoDelete(item, autoDir)
  const scopeRoot = (scope: Scope) => (scope === "global" ? configDir : roots.project)
  return planMemoryFile(change, { label: LABEL, scopeRoot, memoryFiles: MEMORY_FILES })
}

const LISTERS: Record<Kind, (roots: Roots) => Promise<Item[]>> = {
  memory: listMemory,
  mcp: listMcp,
  skill: listSkills,
  plugin: listPlugins,
}

export const claudeCode: HarnessAdapter = {
  id: ID,
  label: LABEL,
  scopes: ["global", "project", "local"],
  memoryFiles: MEMORY_FILES,
  plan,
  async skillRoots(roots) {
    return [
      { path: join(configPaths(roots).configDir, "skills"), scope: "global" },
      { path: join(roots.project, ".claude/skills"), scope: "project" },
    ]
  },
  async detect(roots) {
    const { configDir, claudeJson } = configPaths(roots)
    return existsSync(configDir) || existsSync(claudeJson)
  },
  list: (kind, roots) => LISTERS[kind](roots),
  async read(item) {
    if (item.kind === "mcp") return { type: "mcp", server: await readServer(item) }
    if (item.kind === "plugin") return { type: "plugin", plugin: await readPlugin(item) }
    const path = item.kind === "skill" ? join(item.path, "SKILL.md") : item.path
    return { type: "text", text: await readFile(path, "utf8") }
  },
}
