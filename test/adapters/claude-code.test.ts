import { afterAll, beforeAll, expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { claudeCode } from "../../src/adapters/claude-code"
import type { Change, FileEdit, Item, Kind, McpServer, Roots, Scope, WritePlan } from "../../src/core/model"

// A temp copy, because the auto memory folder name and some JSON keys hold absolute paths.
let base: string
let home: string
let project: string
let agentsOnly: string

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "claude-code-"))
  cpSync(join(import.meta.dir, "../fixtures/claude-code"), base, { recursive: true })
  home = join(base, "home")
  project = join(base, "project")
  agentsOnly = join(base, "project-agents")
  const encoded = project.replace(/[/.]/g, "-")
  mkdirSync(join(home, ".claude/projects", encoded, "memory"), { recursive: true })
  writeFileSync(join(home, ".claude/projects", encoded, "memory/MEMORY.md"), "Remembered\n")
  writeFileSync(
    join(home, ".claude.json"),
    JSON.stringify({
      mcpServers: { linear: { type: "sse", url: "https://mcp.linear.app/sse" } },
      projects: { [project]: { mcpServers: { db: { command: "db-mcp" } } } },
    }),
  )
  const record = (scope: string, installPath: string, projectPath?: string) => ({
    scope,
    installPath,
    version: "1.0.0",
    ...(projectPath && { projectPath }),
  })
  mkdirSync(join(home, ".claude/plugins"))
  writeFileSync(
    join(home, ".claude/plugins/installed_plugins.json"),
    JSON.stringify({
      version: 2,
      plugins: {
        "alpha@mkt": [record("user", join(base, "plugin-alpha"))],
        "beta@mkt": [record("user", join(base, "absent"))],
        "gamma@mkt": [record("project", join(base, "absent"), project)],
        "delta@mkt": [record("local", join(base, "absent"), project)],
        "epsilon@mkt": [record("project", join(base, "absent"), "/elsewhere")],
      },
    }),
  )
})

afterAll(() => rmSync(base, { recursive: true, force: true }))

const roots = (overrides: Partial<Roots> = {}): Roots => ({ home, project, env: {}, ...overrides })
const list = (kind: Kind, r = roots()) => claudeCode.list(kind, r)
const byName = (items: Item[], name: string) => items.find((i) => i.name === name)!

test("detects the config dir and misses an empty home", async () => {
  expect(await claudeCode.detect(roots())).toBe(true)
  expect(await claudeCode.detect(roots({ home: join(base, "absent") }))).toBe(false)
})

test("lists global, project and local memory files that exist", async () => {
  const items = await list("memory")
  const summary = items.map((i) => [i.scope, i.name, i.path])
  expect(summary).toContainEqual(["global", "CLAUDE.md", join(home, ".claude/CLAUDE.md")])
  expect(summary).toContainEqual(["global", "rules/testing.md", join(home, ".claude/rules/testing.md")])
  expect(summary).toContainEqual(["global", "rules/sub/style.md", join(home, ".claude/rules/sub/style.md")])
  expect(summary).toContainEqual(["project", "CLAUDE.md", join(project, "CLAUDE.md")])
  expect(summary).toContainEqual(["project", ".claude/CLAUDE.md", join(project, ".claude/CLAUDE.md")])
  expect(summary).toContainEqual(["project", ".claude/rules/api.md", join(project, ".claude/rules/api.md")])
  expect(summary).toContainEqual(["local", "CLAUDE.local.md", join(project, "CLAUDE.local.md")])
  expect(items.some((i) => i.name.endsWith(".txt"))).toBe(false)
  expect(items.every((i) => i.harness === "claude-code" && i.loadedBy.includes("claude-code"))).toBe(true)
})

test("AGENTS.md is skipped when a CLAUDE.md exists", async () => {
  expect((await list("memory")).some((i) => i.name === "AGENTS.md")).toBe(false)
})

test("AGENTS.md is listed when no CLAUDE.md exists", async () => {
  const agents = byName(await list("memory", roots({ project: agentsOnly })), "AGENTS.md")
  expect(agents).toMatchObject({ scope: "project", path: join(agentsOnly, "AGENTS.md"), loadedBy: ["claude-code"] })
})

test("lists auto memory from the encoded project folder", async () => {
  const memory = byName(await list("memory"), "MEMORY.md")
  expect(memory.scope).toBe("project")
  expect(memory.path).toEndWith("/memory/MEMORY.md")
  expect(memory.loadedBy).toEqual(["claude-code"])
  expect(await claudeCode.read(memory)).toEqual({ type: "text", text: "Remembered\n" })
})

test("CLAUDE_CONFIG_DIR moves the config dir and .claude.json; autoMemoryEnabled false turns auto memory off", async () => {
  const r = roots({ env: { CLAUDE_CONFIG_DIR: join(home, "alt-claude") } })
  const memory = await list("memory", r)
  expect(byName(memory, "CLAUDE.md").path).toBe(join(home, "alt-claude/CLAUDE.md"))
  const notes = byName(memory, "notes.md")
  expect(notes.path).toBe(join(home, "mem/notes.md"))
  expect(notes.loadedBy).toEqual([])
  expect(notes.offIn).toEqual(["claude-code"])
  expect((await list("mcp", r)).filter((i) => i.scope === "global").map((i) => i.name)).toEqual(["alt"])
})

test("lists MCP servers from all three scopes with their keys", async () => {
  const items = await list("mcp")
  const summary = items.map((i) => [i.scope, i.name, i.path, i.key])
  expect(summary).toContainEqual(["global", "linear", join(home, ".claude.json"), "mcpServers.linear"])
  expect(summary).toContainEqual(["local", "db", join(home, ".claude.json"), `projects["${project}"].mcpServers.db`])
  expect(summary).toContainEqual(["project", "files", join(project, ".mcp.json"), "mcpServers.files"])
})

test("disabledMcpjsonServers turns a .mcp.json server off", async () => {
  const items = await list("mcp")
  const off = byName(items, "off-server")
  expect(off.offIn).toEqual(["claude-code"])
  expect(off.loadedBy).toEqual([])
  expect(await claudeCode.read(off)).toMatchObject({ server: { enabled: false } })
  expect(byName(items, "files").offIn).toBeUndefined()
})

test("reads an MCP server, keeping unknown keys in native", async () => {
  const files = byName(await list("mcp"), "files")
  expect(await claudeCode.read(files)).toEqual({
    type: "mcp",
    server: {
      name: "files",
      transport: "stdio",
      enabled: true,
      command: "files-mcp",
      args: ["--root", "."],
      env: { TOKEN: "${TOKEN}" },
      native: { timeout: 5000 },
    },
  })
})

test("streamable-http reads as http", async () => {
  const remote = byName(await list("mcp"), "remote")
  expect(await claudeCode.read(remote)).toMatchObject({
    server: { transport: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer ${KEY}" }, native: {} },
  })
})

test("a ws server is read-only and keeps its type in native", async () => {
  const sock = byName(await list("mcp"), "sock")
  expect(sock.readOnly).toBe("ws transport: edit with claude mcp add-json")
  expect(await claudeCode.read(sock)).toMatchObject({ server: { transport: "http", native: { type: "ws" } } })
})

test("a malformed .mcp.json gives no project servers and does not throw", async () => {
  const items = await list("mcp", roots({ project: agentsOnly }))
  expect(items.some((i) => i.scope === "project")).toBe(false)
  expect(items.map((i) => i.name)).toContain("linear")
})

test("lists global, project and plugin skills; plugin skills are read-only", async () => {
  const items = await list("skill")
  const summary = items.map((i) => [i.scope, i.name, i.path, i.readOnly])
  expect(summary).toContainEqual(["global", "pdf", join(home, ".claude/skills/pdf"), undefined])
  expect(summary).toContainEqual(["project", "research", join(project, ".claude/skills/research"), undefined])
  expect(summary).toContainEqual(["global", "lint", join(base, "plugin-alpha/skills/lint"), "from plugin alpha@mkt"])
  expect(await claudeCode.read(byName(items, "pdf"))).toEqual({ type: "text", text: "---\nname: pdf\n---\nPDF skill\n" })
})

test("plugin enabled state follows local > project > user settings", async () => {
  const items = await list("plugin")
  const state = Object.fromEntries(items.map((i) => [i.name, [i.scope, i.key, i.offIn ?? []]]))
  expect(state).toEqual({
    "alpha@mkt": ["global", "alpha@mkt", []],
    "beta@mkt": ["global", "beta@mkt", ["claude-code"]],
    "gamma@mkt": ["project", "gamma@mkt", []],
    "delta@mkt": ["local", "delta@mkt", ["claude-code"]],
  })
})

test("reads a plugin", async () => {
  const gamma = byName(await list("plugin"), "gamma@mkt")
  expect(await claudeCode.read(gamma)).toEqual({
    type: "plugin",
    plugin: { name: "gamma@mkt", enabled: true, version: "1.0.0", source: "mkt" },
  })
})

const memoryChange = (fields: Partial<Change> & Pick<Change, "op">): Change => ({
  kind: "memory",
  target: { harness: "claude-code", scope: "project" },
  ...fields,
})
const editsOnly = (edits: FileEdit[]): WritePlan => ({ edits, moves: [], copies: [], removals: [], commands: [], notices: [] })

test("plan creates a memory file under the scope root", async () => {
  const global = memoryChange({ op: "create", target: { harness: "claude-code", scope: "global" }, name: "rules/new-rule.md", text: "Rule\n" })
  expect(await claudeCode.plan(global, roots())).toEqual(
    editsOnly([{ path: join(home, ".claude/rules/new-rule.md"), before: null, after: "Rule\n" }]),
  )
  const local = memoryChange({ op: "create", target: { harness: "claude-code", scope: "local" }, name: "CLAUDE.local.md" })
  expect(await claudeCode.plan(local, roots({ project: agentsOnly }))).toEqual(
    editsOnly([{ path: join(agentsOnly, "CLAUDE.local.md"), before: null, after: "" }]),
  )
})

test("plan refuses a name outside memoryFiles and a file that exists", async () => {
  await expect(claudeCode.plan(memoryChange({ op: "create", name: "notes.md" }), roots())).rejects.toThrow("notes.md")
  await expect(claudeCode.plan(memoryChange({ op: "create", name: ".claude/rules/Bad Name.md" }), roots())).rejects.toThrow()
  await expect(claudeCode.plan(memoryChange({ op: "create", name: "CLAUDE.local.md" }), roots())).rejects.toThrow()
  await expect(claudeCode.plan(memoryChange({ op: "create", name: "CLAUDE.md" }), roots())).rejects.toThrow("already exists")
})

test("plan updates and deletes a memory file", async () => {
  const rules = byName(await list("memory"), ".claude/rules/api.md")
  const before = readFileSync(rules.path, "utf8")
  expect(await claudeCode.plan(memoryChange({ op: "update", item: rules, text: "New\n" }), roots())).toEqual(
    editsOnly([{ path: rules.path, before, after: "New\n" }]),
  )
  expect(await claudeCode.plan(memoryChange({ op: "delete", item: rules }), roots())).toEqual({
    ...editsOnly([]),
    removals: [rules.path],
  })
})

test("plan refuses to update or delete a read-only item", async () => {
  const locked: Item = { ...byName(await list("memory"), "CLAUDE.md"), readOnly: "imported from Codex" }
  await expect(claudeCode.plan(memoryChange({ op: "update", item: locked, text: "x" }), roots())).rejects.toThrow("imported from Codex")
  await expect(claudeCode.plan(memoryChange({ op: "delete", item: locked }), roots())).rejects.toThrow("imported from Codex")
})

test("an auto memory entry is created in the auto memory dir and indexed in MEMORY.md", async () => {
  const r = roots({ env: { CLAUDE_CONFIG_DIR: join(base, "auto-config") } })
  const dir = join(base, "auto-config/projects", project.replace(/[/.]/g, "-"), "memory")
  const text = "---\nname: Build steps\ndescription: how to build the app\n---\nRun make.\n"
  expect(await claudeCode.plan(memoryChange({ op: "create", name: "memory/build.md", text }), r)).toEqual(
    editsOnly([
      { path: join(dir, "build.md"), before: null, after: text },
      { path: join(dir, "MEMORY.md"), before: null, after: "- [Build steps](build.md) — how to build the app\n" },
    ]),
  )
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "MEMORY.md"), "# Index")
  const plain = await claudeCode.plan(memoryChange({ op: "create", name: "memory/plain.md", text: "Plain\n" }), r)
  expect(plain.edits[1]).toEqual({ path: join(dir, "MEMORY.md"), before: "# Index", after: "# Index\n- [plain](plain.md)\n" })
})

test("deleting an auto memory entry removes its MEMORY.md lines; deleting MEMORY.md is a plain delete", async () => {
  const r = roots({ env: { CLAUDE_CONFIG_DIR: join(base, "auto-delete") } })
  const dir = join(base, "auto-delete/projects", project.replace(/[/.]/g, "-"), "memory")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "old.md"), "Old\n")
  const index = "# Index\n- [Old](old.md) — stale\n- [Keep](keep.md)\n- again [Old](old.md)\n"
  writeFileSync(join(dir, "MEMORY.md"), index)
  const memory = await list("memory", r)
  expect(await claudeCode.plan(memoryChange({ op: "delete", item: byName(memory, "old.md") }), r)).toEqual({
    ...editsOnly([{ path: join(dir, "MEMORY.md"), before: index, after: "# Index\n- [Keep](keep.md)\n" }]),
    removals: [join(dir, "old.md")],
  })
  expect(await claudeCode.plan(memoryChange({ op: "delete", item: byName(memory, "MEMORY.md") }), r)).toEqual({
    ...editsOnly([]),
    removals: [join(dir, "MEMORY.md")],
  })
})

const PLUGIN_NOTICE = "Restart Claude Code sessions or run /reload-plugins to load this change."
const pluginChange = (scope: Scope, fields: Partial<Change> & Pick<Change, "op">): Change => ({
  kind: "plugin",
  target: { harness: "claude-code", scope },
  ...fields,
})
const pluginTouches = (settings: string) => [
  join(home, ".claude/plugins/installed_plugins.json"),
  join(home, ".claude/plugins/known_marketplaces.json"),
  settings,
]
const commandOnly = (argv: string[], settings: string): WritePlan => ({
  ...editsOnly([]),
  commands: [{ argv, touches: pluginTouches(settings), cwd: project }],
  notices: [PLUGIN_NOTICE],
})
const USER_SETTINGS = () => join(home, ".claude/settings.json")
const PROJECT_SETTINGS = () => join(project, ".claude/settings.json")
const LOCAL_SETTINGS = () => join(project, ".claude/settings.local.json")

test("plugin create installs at the target scope", async () => {
  const plugin = { name: "zeta@mkt", enabled: true }
  expect(await claudeCode.plan(pluginChange("global", { op: "create", plugin }), roots())).toEqual(
    commandOnly(["claude", "plugin", "install", "zeta@mkt", "-s", "user"], USER_SETTINGS()),
  )
  expect(await claudeCode.plan(pluginChange("project", { op: "create", plugin }), roots())).toEqual(
    commandOnly(["claude", "plugin", "install", "zeta@mkt", "-s", "project"], PROJECT_SETTINGS()),
  )
  expect(await claudeCode.plan(pluginChange("local", { op: "create", plugin }), roots())).toEqual(
    commandOnly(["claude", "plugin", "install", "zeta@mkt", "-s", "local"], LOCAL_SETTINGS()),
  )
})

test("plugin delete uninstalls at the item's scope", async () => {
  const gamma = byName(await list("plugin"), "gamma@mkt")
  expect(await claudeCode.plan(pluginChange("global", { op: "delete", item: gamma }), roots())).toEqual(
    commandOnly(["claude", "plugin", "uninstall", "gamma@mkt", "-s", "project"], PROJECT_SETTINGS()),
  )
})

test("plugin update enables, disables or updates from the item's state", async () => {
  const plugins = await list("plugin")
  const alpha = byName(plugins, "alpha@mkt") // on, user
  const delta = byName(plugins, "delta@mkt") // off, local
  const off = await claudeCode.plan(pluginChange("global", { op: "update", item: alpha, plugin: { name: "alpha@mkt", enabled: false } }), roots())
  expect(off).toEqual(commandOnly(["claude", "plugin", "disable", "alpha@mkt", "-s", "user"], USER_SETTINGS()))
  const on = await claudeCode.plan(pluginChange("local", { op: "update", item: delta, plugin: { name: "delta@mkt", enabled: true } }), roots())
  expect(on).toEqual(commandOnly(["claude", "plugin", "enable", "delta@mkt", "-s", "local"], LOCAL_SETTINGS()))
  const same = await claudeCode.plan(pluginChange("global", { op: "update", item: alpha, plugin: { name: "alpha@mkt", enabled: true } }), roots())
  expect(same).toEqual(commandOnly(["claude", "plugin", "update", "alpha@mkt", "-s", "user"], USER_SETTINGS()))
})

test("marketplace create adds and delete removes at the target scope", async () => {
  const add = await claudeCode.plan(pluginChange("project", { op: "create", marketplace: "acme/plugins" }), roots())
  expect(add).toEqual(commandOnly(["claude", "plugin", "marketplace", "add", "acme/plugins", "--scope", "project"], PROJECT_SETTINGS()))
  const remove = await claudeCode.plan(pluginChange("global", { op: "delete", marketplace: "acme" }), roots())
  expect(remove).toEqual(commandOnly(["claude", "plugin", "marketplace", "remove", "acme", "--scope", "user"], USER_SETTINGS()))
})

test("plugin plan refuses read-only items and move or copy", async () => {
  const locked: Item = { ...byName(await list("plugin"), "alpha@mkt"), readOnly: "managed by policy" }
  await expect(claudeCode.plan(pluginChange("global", { op: "delete", item: locked }), roots())).rejects.toThrow("managed by policy")
  const alpha = byName(await list("plugin"), "alpha@mkt")
  await expect(claudeCode.plan(pluginChange("global", { op: "move", item: alpha }), roots())).rejects.toThrow("Claude Code: plugins cannot move")
})

test("marketplaces reads known_marketplaces.json", async () => {
  const configDir = join(base, "marketplace-config")
  mkdirSync(join(configDir, "plugins"), { recursive: true })
  writeFileSync(
    join(configDir, "plugins/known_marketplaces.json"),
    JSON.stringify({
      official: { source: { source: "github", repo: "acme/official" }, installLocation: "/x", lastUpdated: "2026-01-01T00:00:00.000Z" },
      team: { source: { source: "git", url: "https://git.example.com/team.git" } },
      mine: { source: { source: "directory", path: "/work/mine" } },
    }),
  )
  expect(await claudeCode.marketplaces!(roots({ env: { CLAUDE_CONFIG_DIR: configDir } }))).toEqual([
    { name: "official", source: "acme/official" },
    { name: "team", source: "https://git.example.com/team.git" },
    { name: "mine", source: "/work/mine" },
  ])
  expect(await claudeCode.marketplaces!(roots({ home: join(base, "absent") }))).toEqual([])
})

const RESTART = "Restart Claude Code sessions to load this change."
const stdioServer = (fields: Partial<McpServer> = {}): McpServer => ({
  name: "new",
  transport: "stdio",
  enabled: true,
  command: "new-mcp",
  args: ["--fast"],
  env: { KEY: "${KEY}" },
  native: { timeout: 10, type: "ws", command: "native-wins" },
  ...fields,
})
const STDIO_ENTRY = { timeout: 10, type: "stdio", command: "new-mcp", args: ["--fast"], env: { KEY: "${KEY}" } }
const mcpChange = (scope: Scope, fields: Partial<Change> & Pick<Change, "op">): Change => ({
  kind: "mcp",
  target: { harness: "claude-code", scope },
  ...fields,
})
const claudeCommand = (...args: string[]) => ({ argv: ["claude", "mcp", ...args], touches: [join(home, ".claude.json")], cwd: project })
const previewServers = (plan: WritePlan, scope: Scope) => {
  const [edit] = plan.edits
  expect(edit).toMatchObject({ path: join(home, ".claude.json"), before: readFileSync(join(home, ".claude.json"), "utf8"), previewOnly: true })
  const file = JSON.parse(edit!.after!)
  return scope === "global" ? file.mcpServers : file.projects[project].mcpServers
}

test("creating a user or local server runs claude mcp add-json and previews .claude.json", async () => {
  const user = await claudeCode.plan(mcpChange("global", { op: "create", server: stdioServer() }), roots())
  expect(user.commands).toEqual([claudeCommand("add-json", "-s", "user", "new", JSON.stringify(STDIO_ENTRY))])
  expect(previewServers(user, "global")).toEqual({ linear: { type: "sse", url: "https://mcp.linear.app/sse" }, new: STDIO_ENTRY })
  expect(user.notices).toEqual([RESTART])
  const http = stdioServer({ transport: "http", url: "https://x.dev/mcp", headers: { A: "${B}" }, native: {} })
  const local = await claudeCode.plan(mcpChange("local", { op: "create", server: http }), roots())
  const httpEntry = { type: "http", url: "https://x.dev/mcp", headers: { A: "${B}" } }
  expect(local.commands).toEqual([claudeCommand("add-json", "-s", "local", "new", JSON.stringify(httpEntry))])
  expect(previewServers(local, "local")).toEqual({ db: { command: "db-mcp" }, new: httpEntry })
  expect(local.notices).toEqual([RESTART])
})

test("updating a user server removes then adds it; a local rename removes the old name", async () => {
  const items = await list("mcp")
  const linear = { name: "linear", transport: "sse", enabled: true, url: "https://new.dev/sse", native: {} } satisfies McpServer
  const update = await claudeCode.plan(mcpChange("global", { op: "update", item: byName(items, "linear"), server: linear }), roots())
  const sseEntry = { type: "sse", url: "https://new.dev/sse" }
  expect(update.commands).toEqual([
    claudeCommand("remove", "-s", "user", "linear"),
    claudeCommand("add-json", "-s", "user", "linear", JSON.stringify(sseEntry)),
  ])
  expect(previewServers(update, "global")).toEqual({ linear: sseEntry })
  const renamed = stdioServer({ name: "db2", native: {} })
  const rename = await claudeCode.plan(mcpChange("local", { op: "update", item: byName(items, "db"), server: renamed }), roots())
  const { timeout, ...entry } = STDIO_ENTRY
  expect(rename.commands).toEqual([claudeCommand("remove", "-s", "local", "db"), claudeCommand("add-json", "-s", "local", "db2", JSON.stringify(entry))])
  expect(previewServers(rename, "local")).toEqual({ db2: entry })
  expect(rename.notices).toEqual([RESTART])
})

test("deleting a user server runs claude mcp remove and previews the entry gone", async () => {
  const plan = await claudeCode.plan(mcpChange("global", { op: "delete", item: byName(await list("mcp"), "linear") }), roots())
  expect(plan.commands).toEqual([claudeCommand("remove", "-s", "user", "linear")])
  expect(previewServers(plan, "global")).toEqual({})
  expect(plan.notices).toEqual([RESTART])
})

test("turning off a user or local server throws", async () => {
  const message = "Claude Code: user and local servers cannot be turned off; delete the server instead"
  const off = stdioServer({ enabled: false })
  await expect(claudeCode.plan(mcpChange("global", { op: "create", server: off }), roots())).rejects.toThrow(message)
  const db = byName(await list("mcp"), "db")
  await expect(claudeCode.plan(mcpChange("local", { op: "update", item: db, server: off }), roots())).rejects.toThrow(message)
})

test("a read-only server is refused with its reason", async () => {
  const sock = byName(await list("mcp"), "sock")
  await expect(claudeCode.plan(mcpChange("project", { op: "delete", item: sock }), roots())).rejects.toThrow("ws transport")
})

test("a project server is added to an existing .mcp.json, keeping other keys and formatting", async () => {
  const path = join(project, ".mcp.json")
  const before = readFileSync(path, "utf8")
  const plan = await claudeCode.plan(mcpChange("project", { op: "create", server: stdioServer() }), roots())
  expect(plan.commands).toEqual([])
  expect(plan.notices).toEqual([RESTART])
  const [edit] = plan.edits
  expect(edit).toMatchObject({ path, before })
  expect(edit!.previewOnly).toBeUndefined()
  expect(edit!.after).toContain(`    "files": { "command": "files-mcp", "args": ["--root", "."], "env": { "TOKEN": "\${TOKEN}" }, "timeout": 5000 },\n`)
  const servers = JSON.parse(edit!.after!).mcpServers
  expect(Object.keys(servers)).toEqual(["files", "off-server", "sock", "remote", "new"])
  expect(servers.new).toEqual(STDIO_ENTRY)
})

test("a project server creates .mcp.json when absent; delete removes the key", async () => {
  const empty = join(base, "project-empty")
  mkdirSync(empty)
  const plan = await claudeCode.plan(mcpChange("project", { op: "create", server: stdioServer() }), roots({ project: empty }))
  expect(plan.edits).toHaveLength(1)
  expect(plan.edits[0]).toMatchObject({ path: join(empty, ".mcp.json"), before: null })
  expect(JSON.parse(plan.edits[0]!.after!)).toEqual({ mcpServers: { new: STDIO_ENTRY } })
  const files = byName(await list("mcp"), "files")
  const remove = await claudeCode.plan(mcpChange("project", { op: "delete", item: files }), roots())
  expect(Object.keys(JSON.parse(remove.edits[0]!.after!).mcpServers)).toEqual(["off-server", "sock", "remote"])
  expect(remove.notices).toEqual([RESTART])
})

test("turning a project server off or on edits disabledMcpjsonServers only", async () => {
  const items = await list("mcp")
  const files = byName(items, "files")
  const filesServer = ((await claudeCode.read(files)) as { server: McpServer }).server
  const off = await claudeCode.plan(mcpChange("project", { op: "update", item: files, server: { ...filesServer, enabled: false } }), roots())
  const localPath = join(project, ".claude/settings.local.json")
  expect(off.edits).toHaveLength(1)
  expect(off.edits[0]).toMatchObject({ path: localPath, before: readFileSync(localPath, "utf8") })
  expect(JSON.parse(off.edits[0]!.after!)).toEqual({ enabledPlugins: { "gamma@mkt": true }, disabledMcpjsonServers: ["files"] })
  expect(off.notices).toEqual([RESTART])
  const offServer = byName(items, "off-server")
  const offRead = ((await claudeCode.read(offServer)) as { server: McpServer }).server
  const on = await claudeCode.plan(mcpChange("project", { op: "update", item: offServer, server: { ...offRead, enabled: true } }), roots())
  const sharedPath = join(project, ".claude/settings.json")
  expect(on.edits).toHaveLength(1)
  expect(on.edits[0]!.path).toBe(sharedPath)
  expect(JSON.parse(on.edits[0]!.after!)).toEqual({ enabledPlugins: { "beta@mkt": false, "gamma@mkt": false }, disabledMcpjsonServers: [] })
})

test("turning a project server off creates settings.local.json when absent", async () => {
  const fresh = join(base, "project-fresh")
  mkdirSync(fresh)
  writeFileSync(join(fresh, ".mcp.json"), '{ "mcpServers": { "files": { "command": "files-mcp" } } }')
  const files = byName(await list("mcp", roots({ project: fresh })), "files")
  const server: McpServer = { name: "files", transport: "stdio", enabled: false, command: "files-mcp", native: {} }
  const plan = await claudeCode.plan(mcpChange("project", { op: "update", item: files, server }), roots({ project: fresh }))
  expect(plan.edits).toHaveLength(1)
  expect(plan.edits[0]).toMatchObject({ path: join(fresh, ".claude/settings.local.json"), before: null })
  expect(JSON.parse(plan.edits[0]!.after!)).toEqual({ disabledMcpjsonServers: ["files"] })
})

test("memoryFiles and skillRoots", async () => {
  expect(claudeCode.memoryFiles.local).toEqual(["CLAUDE.local.md"])
  expect(await claudeCode.skillRoots(roots())).toEqual([
    { path: join(home, ".claude/skills"), scope: "global" },
    { path: join(project, ".claude/skills"), scope: "project" },
  ])
})

test("a project create refuses a name that .mcp.json already holds", async () => {
  await expect(claudeCode.plan(mcpChange("project", { op: "create", server: stdioServer({ name: "files" }) }), roots())).rejects.toThrow(
    "Claude Code: files already exists in",
  )
})
