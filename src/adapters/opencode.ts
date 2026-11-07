import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { parse, type JSONPath, type ParseError } from "jsonc-parser"
import type { Change, HarnessAdapter, Item, ItemDetail, Kind, McpServer, PluginInfo, Roots, Scope, WritePlan } from "../core/model"
import { emptyPlan, planMemoryFile } from "../core/memory-plan"
import { setJsonc } from "../core/json-edit"
import { listSkillFolders } from "../core/skills"

type Shape = "v1" | "v2" | "unknown"
type Config = Record<string, unknown>
interface ConfigFile {
  path: string
  scope: Scope
  data: Config
  shape: Shape
}

const OPENCODE = "opencode" as const
const isObject = (value: unknown): value is Config => typeof value === "object" && value !== null && !Array.isArray(value)

function parseConfig(text: string): Config | undefined {
  const errors: ParseError[] = []
  const data: unknown = parse(text, errors, { allowTrailingComma: true })
  return errors.length === 0 && isObject(data) ? data : undefined
}

function shapeOf(data: Config | undefined): Shape {
  if (!data) return "unknown"
  if ((isObject(data.mcp) && isObject(data.mcp.servers)) || "plugins" in data) return "v2"
  const v1Mcp = isObject(data.mcp) && Object.values(data.mcp).some((entry) => isObject(entry) && "type" in entry)
  return "plugin" in data || v1Mcp ? "v1" : "unknown"
}

export function configShape(text: string): Shape {
  return shapeOf(parseConfig(text))
}

const configDir = (roots: Roots) => join(roots.env.XDG_CONFIG_HOME ?? join(roots.home, ".config"), "opencode")
const claudeOptOut = (roots: Roots, part: "PROMPT" | "SKILLS") =>
  Boolean(roots.env.OPENCODE_DISABLE_CLAUDE_CODE || roots.env[`OPENCODE_DISABLE_CLAUDE_CODE_${part}`])

// Lowest precedence first: global, project direct files, then project .opencode files.
function configPaths(roots: Roots): { path: string; scope: Scope }[] {
  const names = ["opencode.json", "opencode.jsonc"]
  const dirs: [string, Scope][] = [
    [configDir(roots), "global"],
    [roots.project, "project"],
    [join(roots.project, ".opencode"), "project"],
  ]
  return dirs.flatMap(([dir, scope]) => names.map((name) => ({ path: join(dir, name), scope })))
}

async function readConfig(path: string): Promise<Config | undefined> {
  return existsSync(path) ? parseConfig(await readFile(path, "utf8")) : undefined
}

async function loadConfigs(roots: Roots): Promise<ConfigFile[]> {
  const files: ConfigFile[] = []
  for (const { path, scope } of configPaths(roots)) {
    const data = await readConfig(path)
    if (data) files.push({ path, scope, data, shape: shapeOf(data) })
  }
  return files
}

// The CLAUDE.md fallback depends on the version; a machine without a known shape is treated as v2.
const harnessVersion = (files: ConfigFile[]) => files.find((file) => file.shape !== "unknown")?.shape ?? "v2"

function item(kind: Item["kind"], scope: Scope, path: string): Item {
  return { kind, harness: OPENCODE, scope, name: basename(path), path, loadedBy: [OPENCODE] }
}

// ---- memory

function projectDirs(roots: Roots): string[] {
  const dirs: string[] = []
  for (let dir = roots.project; dir !== roots.home && dir !== dirname(dir); dir = dirname(dir)) dirs.push(dir)
  return dirs
}

function memoryAt(dir: string, fallback: string | undefined, scope: Scope): Item[] {
  const agents = join(dir, "AGENTS.md")
  if (existsSync(agents)) return [item("memory", scope, agents)]
  return fallback && existsSync(fallback) ? [item("memory", scope, fallback)] : []
}

async function expandInstruction(pattern: string): Promise<string[]> {
  if (!/[*?[{]/.test(pattern)) return existsSync(pattern) ? [pattern] : []
  return (await Array.fromAsync(new Bun.Glob(pattern).scan({ absolute: true, onlyFiles: true }))).sort()
}

// Local paths resolve against the config file's folder; URLs are not files, so they are skipped.
async function instructionPaths(file: ConfigFile, home: string): Promise<string[]> {
  const entries = Array.isArray(file.data.instructions) ? file.data.instructions : []
  const paths: string[] = []
  for (const entry of entries) {
    if (typeof entry !== "string" || /^https?:\/\//.test(entry)) continue
    paths.push(...(await expandInstruction(resolve(dirname(file.path), entry.replace(/^~(?=\/|$)/, home)))))
  }
  return paths
}

async function listMemory(roots: Roots, files: ConfigFile[]): Promise<Item[]> {
  const fallback = harnessVersion(files) === "v1" && !claudeOptOut(roots, "PROMPT")
  const items = memoryAt(configDir(roots), fallback ? join(roots.home, ".claude/CLAUDE.md") : undefined, "global")
  for (const dir of projectDirs(roots)) {
    items.push(...memoryAt(dir, fallback ? join(dir, "CLAUDE.md") : undefined, "project"))
  }
  for (const file of files) {
    for (const path of await instructionPaths(file, roots.home)) items.push(item("memory", file.scope, path))
  }
  return items
}

const MEMORY_FILES: Partial<Record<Scope, string[]>> = { global: ["AGENTS.md"], project: ["AGENTS.md"] }

const planMemory = (change: Change, roots: Roots) =>
  planMemoryFile(change, { label: "OpenCode", scopeRoot: (scope) => (scope === "global" ? configDir(roots) : roots.project), memoryFiles: MEMORY_FILES })

// ---- mcp

function mcpEntries(file: ConfigFile): [string, Config][] {
  const mcp = isObject(file.data.mcp) ? file.data.mcp : {}
  if (file.shape === "v2") return Object.entries(isObject(mcp.servers) ? mcp.servers : {}).map(([name, e]) => [`mcp.servers.${name}`, e as Config])
  if (file.shape === "v1") return Object.entries(mcp).filter(([, e]) => isObject(e)).map(([name, e]) => [`mcp.${name}`, e as Config])
  return []
}

const serverName = (key: string) => key.replace(/^mcp\.(servers\.)?/, "")
const isEnabled = (entry: Config) => ("disabled" in entry ? !entry.disabled : entry.enabled !== false)

interface McpCopy {
  file: ConfigFile
  key: string
  entry: Config
}

function mcpItem({ file, key, entry }: McpCopy, winner: string): Item {
  const offIn = !isEnabled(entry) || winner !== file.path ? [OPENCODE] : undefined
  const warnings = winner !== file.path ? [`overridden by ${winner}`] : undefined
  return { ...item("mcp", file.scope, file.path), name: serverName(key), key, offIn, warnings }
}

function listMcp(files: ConfigFile[]): Item[] {
  const found: McpCopy[] = files.flatMap((file) => mcpEntries(file).map(([key, entry]) => ({ file, key, entry })))
  const winners = new Map(found.map(({ file, key }) => [serverName(key), file.path])) // last copy wins
  return found.map((copy) => mcpItem(copy, winners.get(serverName(copy.key))!))
}

const envRefs = (values: unknown) =>
  isObject(values)
    ? Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v).replace(/\{env:([^}]+)\}/g, "$${$1}")]))
    : undefined

function toServer(name: string, entry: Config): McpServer {
  const { type, command, url, headers, environment, enabled, disabled, ...native } = entry
  const server: McpServer = { name, transport: type === "remote" ? "http" : "stdio", enabled: isEnabled(entry), native }
  if (Array.isArray(command)) {
    server.command = String(command[0])
    server.args = command.slice(1).map(String)
  }
  if (typeof url === "string") server.url = url
  if (envRefs(headers)) server.headers = envRefs(headers)
  if (envRefs(environment)) server.env = envRefs(environment)
  return server
}

// The shape a new or shape-unknown file gets. OPENCODE_VERSION in roots.env replaces `opencode --version` (tests).
function installedShape(roots: Roots): "v1" | "v2" {
  const binary = roots.env.OPENCODE_VERSION === undefined ? Bun.which("opencode") : null
  const version = roots.env.OPENCODE_VERSION ?? (binary ? Bun.spawnSync([binary, "--version"]).stdout.toString() : "")
  return /^\D*1\./.test(version.trim()) ? "v1" : "v2"
}

const toEnvRefs = (values: Record<string, string> | undefined) =>
  values && Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.replace(/\$\{([^}]+)\}/g, "{env:$1}")]))

function toEntry(server: McpServer, shape: "v1" | "v2"): Config {
  const { type: _type, command: _command, url: _url, enabled: _enabled, disabled: _disabled, ...native } = server.native
  const entry: Config =
    server.transport === "stdio"
      ? { ...native, type: "local", command: [server.command, ...(server.args ?? [])], environment: toEnvRefs(server.env) }
      : { ...native, type: "remote", url: server.url, headers: toEnvRefs(server.headers) }
  if (shape === "v1" && !server.enabled) entry.enabled = false
  if (shape === "v2" && !server.enabled) entry.disabled = true
  return JSON.parse(JSON.stringify(entry)) // drops undefined fields
}

const mcpPath = (shape: "v1" | "v2", name: string): JSONPath => (shape === "v1" ? ["mcp", name] : ["mcp", "servers", name])

// Global files sit in the config dir, project files in the project root; .jsonc wins over .json, else a new .json.
function createTarget(scope: Scope, roots: Roots): string {
  const dir = scope === "global" ? configDir(roots) : roots.project
  return [join(dir, "opencode.jsonc"), join(dir, "opencode.json")].find(existsSync) ?? join(dir, "opencode.json")
}

async function planMcp(change: Change, roots: Roots): Promise<WritePlan> {
  const item = change.item
  if (item?.readOnly) throw new Error(`OpenCode: ${item.name} is read-only (${item.readOnly})`)
  const path = item ? item.path : createTarget(change.target.scope, roots)
  const before = existsSync(path) ? await readFile(path, "utf8") : null
  const data = before === null ? undefined : parseConfig(before)
  const known = shapeOf(data)
  const shape = item ? (item.key!.startsWith("mcp.servers.") ? "v2" : "v1") : known === "unknown" ? installedShape(roots) : known
  let after = before ?? "{}\n"
  if (item) after = setJsonc(after, mcpPath(shape, item.name), undefined)
  if (change.op !== "delete") {
    const server = change.server!
    const taken = data && mcpEntries({ path, scope: change.target.scope, data, shape }).some(([key]) => serverName(key) === server.name)
    if (taken && server.name !== item?.name) throw new Error(`OpenCode: ${server.name} already exists in ${path}`)
    after = setJsonc(after, mcpPath(shape, server.name), toEntry(server, shape))
  }
  return { ...emptyPlan(), edits: [{ path, before, after }], notices: ["Restart OpenCode to load this change."] }
}

// ---- skills

function skillRoots(roots: Roots): { dir: string; scope: Scope; off: boolean }[] {
  const off = claudeOptOut(roots, "SKILLS")
  const config = configDir(roots)
  const project = (dir: string) => join(roots.project, dir)
  return [
    { dir: join(config, "skills"), scope: "global", off: false },
    { dir: join(config, "skill"), scope: "global", off: false },
    { dir: join(roots.home, ".claude/skills"), scope: "global", off },
    { dir: join(roots.home, ".agents/skills"), scope: "global", off: false },
    { dir: project(".opencode/skills"), scope: "project", off: false },
    { dir: project(".opencode/skill"), scope: "project", off: false },
    { dir: project(".claude/skills"), scope: "project", off },
    { dir: project(".agents/skills"), scope: "project", off: false },
  ]
}

async function listSkills(roots: Roots): Promise<Item[]> {
  const items: Item[] = []
  for (const { dir, scope, off } of skillRoots(roots)) {
    for (const folder of await listSkillFolders(dir)) {
      items.push({ ...item("skill", scope, folder.path), name: folder.name, offIn: off ? [OPENCODE] : undefined })
    }
  }
  return items
}

// ---- plugins

const pluginArray = (file: ConfigFile): [string, unknown[]] | undefined => {
  const field = file.shape === "v2" ? "plugins" : "plugin"
  const entries = file.data[field]
  return Array.isArray(entries) ? [field, entries] : undefined
}

function toPlugin(entry: unknown): PluginInfo | undefined {
  const spec = typeof entry === "string" ? entry : isObject(entry) ? entry.package : undefined
  if (typeof spec !== "string") return undefined
  const enabled = !spec.startsWith("-")
  const pkg = enabled ? spec : spec.slice(1)
  const at = pkg.lastIndexOf("@")
  if (at <= 0) return { name: pkg, enabled, source: "npm" }
  return { name: pkg.slice(0, at), enabled, version: pkg.slice(at + 1), source: "npm" }
}

function arrayPlugins(file: ConfigFile): Item[] {
  const [field, entries] = pluginArray(file) ?? ["", []]
  return entries.flatMap((entry, index) => {
    const plugin = toPlugin(entry)
    if (!plugin) return []
    const offIn = plugin.enabled ? undefined : [OPENCODE]
    return [{ ...item("plugin", file.scope, file.path), name: plugin.name, key: `${field}[${index}]`, offIn }]
  })
}

async function localPlugins(roots: Roots): Promise<Item[]> {
  const dirs: [string, Scope][] = [
    [join(configDir(roots), "plugins"), "global"],
    [join(configDir(roots), "plugin"), "global"],
    [join(roots.project, ".opencode/plugins"), "project"],
    [join(roots.project, ".opencode/plugin"), "project"],
  ]
  const items: Item[] = []
  for (const [dir, scope] of dirs) {
    if (!existsSync(dir)) continue
    for (const name of (await readdir(dir)).sort()) items.push(item("plugin", scope, join(dir, name)))
  }
  return items
}

async function readPlugin(item: Item): Promise<PluginInfo> {
  if (!item.key) return { name: item.name, enabled: true, source: item.path }
  const index = Number(/\[(\d+)\]$/.exec(item.key)![1])
  const data = await readConfig(item.path)
  const file = { path: item.path, scope: item.scope, data: data ?? {}, shape: shapeOf(data) }
  return toPlugin(pluginArray(file)?.[1][index])!
}

const PLUGIN_NOTICE = "Restart OpenCode to load this change; it installs npm plugins at start-up."
const pluginSpec = (plugin: PluginInfo) => (plugin.version ? `${plugin.name}@${plugin.version}` : plugin.name)

async function planPlugin(change: Change, roots: Roots): Promise<WritePlan> {
  const item = change.item
  if (item?.readOnly) throw new Error(`OpenCode: ${item.name} is read-only (${item.readOnly})`)
  if (item && !item.key) {
    if (change.op !== "delete") throw new Error(`OpenCode: ${item.name} is a local plugin file; it cannot be turned off or updated, only uninstalled`)
    return { ...emptyPlan(), removals: [item.path], notices: [PLUGIN_NOTICE] }
  }
  const path = item ? item.path : createTarget(change.target.scope, roots)
  const before = existsSync(path) ? await readFile(path, "utf8") : null
  const after = item ? editPluginEntry(change, item, before ?? "") : addPlugin(change.plugin!, { path, before }, roots)
  return { ...emptyPlan(), edits: [{ path, before, after }], notices: [PLUGIN_NOTICE] }
}

function addPlugin(plugin: PluginInfo, { path, before }: { path: string; before: string | null }, roots: Roots): string {
  const data = before === null ? undefined : parseConfig(before)
  const known = shapeOf(data)
  const shape = known === "unknown" ? installedShape(roots) : known
  const entries = pluginArray({ path, scope: "global", data: data ?? {}, shape })?.[1] ?? []
  if (entries.some((entry) => toPlugin(entry)?.name === plugin.name)) throw new Error(`OpenCode: ${plugin.name} is already in ${path}`)
  return setJsonc(before ?? "{}\n", [shape === "v2" ? "plugins" : "plugin", -1], pluginSpec(plugin))
}

// jsonc-parser 3.3.1 corrupts a one-line array when it removes the last element, so the element is cut here.
// The item key ("plugins[2]") names the array and the index; "-name" entries are v2's way to turn a plugin off.
function editPluginEntry(change: Change, item: Item, text: string): string {
  const [, field, index] = /^(\w+)\[(\d+)\]$/.exec(item.key!)!
  const at: JSONPath = [field!, Number(index)]
  if (change.op === "delete") return setJsonc(text, at, undefined)
  const plugin = change.plugin!
  const entry = (parseConfig(text)?.[field!] as unknown[])[Number(index)]
  const current = toPlugin(entry)!
  if (plugin.enabled !== current.enabled && field === "plugin") throw new Error("OpenCode 1.x cannot turn a plugin off; uninstall it instead")
  // v2 turns a plugin off with a leading "-"; toggling rewrites the same entry so it stays one row.
  const spec = (plugin.enabled ? "" : "-") + pluginSpec({ ...plugin, version: plugin.version ?? current.version })
  return setJsonc(text, isObject(entry) ? [...at, "package"] : at, spec)
}

// ---- adapter

async function listKind(kind: Kind, roots: Roots): Promise<Item[]> {
  const files = await loadConfigs(roots)
  if (kind === "memory") return listMemory(roots, files)
  if (kind === "mcp") return listMcp(files)
  if (kind === "skill") return listSkills(roots)
  return [...files.flatMap(arrayPlugins), ...(await localPlugins(roots))]
}

export const opencode: HarnessAdapter = {
  id: OPENCODE,
  label: "OpenCode",
  scopes: ["global", "project"],
  memoryFiles: MEMORY_FILES,
  async detect(roots) {
    return existsSync(configDir(roots))
  },
  async plan(change, roots) {
    if (change.kind === "mcp") return planMcp(change, roots)
    if (change.kind === "plugin") return planPlugin(change, roots)
    if (change.kind !== "memory") throw new Error(`OpenCode: ${change.kind} changes are not supported yet`)
    return planMemory(change, roots)
  },
  async skillRoots(roots) {
    return skillRoots(roots)
      .filter(({ off }) => !off)
      .map(({ dir, scope }) => ({ path: dir, scope }))
  },
  async list(kind, roots) {
    const items = await listKind(kind, roots)
    return items.map((entry) => (entry.offIn?.includes(OPENCODE) ? { ...entry, loadedBy: [] } : entry))
  },
  async read(item): Promise<ItemDetail> {
    if (item.kind === "plugin") return { type: "plugin", plugin: await readPlugin(item) }
    if (item.kind === "mcp") {
      const data = (await readConfig(item.path)) ?? {}
      const file = { path: item.path, scope: item.scope, data, shape: shapeOf(data) }
      const entry = mcpEntries(file).find(([key]) => key === item.key)![1]
      return { type: "mcp", server: toServer(item.name, entry) }
    }
    const path = item.kind === "skill" ? join(item.path, "SKILL.md") : item.path
    return { type: "text", text: await readFile(path, "utf8") }
  },
}
