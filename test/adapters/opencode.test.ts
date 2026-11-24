import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse } from "jsonc-parser"
import { configShape, opencode } from "../../src/adapters/opencode"
import type { Change, Item, McpServer, PluginInfo, Roots, Scope } from "../../src/core/model"

const fixtures = join(import.meta.dir, "../fixtures/opencode")

function roots(version: string, env: Record<string, string> = {}): Roots {
  const home = join(fixtures, version, "home")
  return { home, project: join(home, "work/project"), env }
}

const v1 = roots("v1")
const v2 = roots("v2")
const byKey = (items: Item[], key: string) => items.filter((item) => item.key === key)

test("configShape tells v1, v2 and unknown apart", () => {
  expect(configShape('{ "mcp": { "servers": {} } }')).toBe("v2")
  expect(configShape('{ "plugins": [] }')).toBe("v2")
  expect(configShape('{ "plugin": [] }')).toBe("v1")
  expect(configShape('{ /* c */ "mcp": { "gh": { "type": "local" } } }')).toBe("v1")
  expect(configShape('{ "theme": "dark" }')).toBe("unknown")
  expect(configShape("{ broken")).toBe("unknown")
})

test("detect checks for the config dir, honouring XDG_CONFIG_HOME", async () => {
  expect(await opencode.detect(v2)).toBe(true)
  expect(await opencode.detect({ ...v2, env: { XDG_CONFIG_HOME: join(fixtures, "absent") } })).toBe(false)
})

test("v2 MCP servers map local and remote, convert env refs, honour disabled", async () => {
  const items = await opencode.list("mcp", v2)
  const fs = byKey(items, "mcp.servers.fs")[0]!
  expect(fs.offIn).toEqual(["opencode"])
  expect(fs.loadedBy).toEqual([]) // an off harness is not in loadedBy
  expect(await opencode.read(fs)).toEqual({
    type: "mcp",
    server: {
      name: "fs",
      transport: "stdio",
      enabled: false,
      command: "npx",
      args: ["-y", "fs-mcp"],
      env: { ROOT: "${HOME}/code" },
      native: { timeout: 5000 },
    },
  })
  const globalLinear = items.find((item) => item.key === "mcp.servers.linear" && item.scope === "global")!
  expect(await opencode.read(globalLinear)).toEqual({
    type: "mcp",
    server: {
      name: "linear",
      transport: "http",
      enabled: true,
      url: "https://mcp.linear.app/sse",
      headers: { Authorization: "Bearer ${LINEAR_TOKEN}" },
      native: {},
    },
  })
})

test("v2 .opencode config overrides every direct config; the others are shadowed", async () => {
  const linear = byKey(await opencode.list("mcp", v2), "mcp.servers.linear")
  const winner = join(v2.project, ".opencode/opencode.jsonc")
  expect(linear.map((item) => item.path)).toEqual([
    join(v2.home, ".config/opencode/opencode.jsonc"),
    join(v2.project, "opencode.json"),
    winner,
  ])
  expect(linear[2]!.offIn).toBeUndefined()
  for (const shadowed of linear.slice(0, 2)) {
    expect(shadowed.offIn).toEqual(["opencode"])
    expect(shadowed.warnings).toEqual([`overridden by ${winner}`])
  }
})

test("v1 MCP servers use mcp.<name> and enabled; the project copy wins", async () => {
  const items = await opencode.list("mcp", v1)
  const github = byKey(items, "mcp.github")[0]!
  expect(github.offIn).toEqual(["opencode"])
  expect(await opencode.read(github)).toEqual({
    type: "mcp",
    server: {
      name: "github",
      transport: "stdio",
      enabled: false,
      command: "gh-mcp",
      args: ["--stdio"],
      env: { TOKEN: "${GH_TOKEN}" },
      native: {},
    },
  })
  const docs = byKey(items, "mcp.docs")
  expect(docs.map((item) => item.scope)).toEqual(["global", "project"])
  expect(docs[0]!.warnings).toEqual([`overridden by ${join(v1.project, "opencode.jsonc")}`])
  expect(docs[1]!.offIn).toBeUndefined()
})

test("v2 memory: AGENTS.md walk up to home, instructions paths and globs, URLs skipped, no CLAUDE.md", async () => {
  const items = await opencode.list("memory", v2)
  const config = join(v2.home, ".config/opencode")
  expect(items.map((item) => [item.scope, item.path])).toEqual([
    ["global", join(config, "AGENTS.md")],
    ["project", join(v2.project, "AGENTS.md")],
    ["project", join(v2.home, "work/AGENTS.md")],
    ["global", join(config, "rules/a.md")],
    ["global", join(v2.home, "notes.md")],
  ])
  expect(items.every((item) => item.loadedBy.join() === "opencode")).toBe(true)
  expect(await opencode.read(items[0]!)).toEqual({ type: "text", text: "# global agents\n" })
})

test("v1 memory falls back to CLAUDE.md where no AGENTS.md exists", async () => {
  const items = await opencode.list("memory", v1)
  expect(items.map((item) => item.path)).toEqual([
    join(v1.home, ".claude/CLAUDE.md"),
    join(v1.project, "CLAUDE.md"),
    join(v1.home, "work/AGENTS.md"),
  ])
})

test("v1 CLAUDE.md fallback turns off with either env opt-out", async () => {
  for (const name of ["OPENCODE_DISABLE_CLAUDE_CODE", "OPENCODE_DISABLE_CLAUDE_CODE_PROMPT"]) {
    const items = await opencode.list("memory", roots("v1", { [name]: "1" }))
    expect(items.map((item) => item.path)).toEqual([join(v1.home, "work/AGENTS.md")])
  }
})

test("skills come from every root; .claude roots turn off with the env opt-out", async () => {
  const items = await opencode.list("skill", v2)
  expect(items.map((item) => [item.scope, item.name])).toEqual([
    ["global", "pdf"],
    ["global", "research"],
    ["global", "shared"],
    ["project", "deploy"],
  ])
  expect(items.some((item) => item.offIn)).toBe(false)
  const off = await opencode.list("skill", roots("v2", { OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1" }))
  expect(off.filter((item) => item.offIn).map((item) => item.name)).toEqual(["research"])
  expect(await opencode.read(items[0]!)).toEqual({ type: "text", text: "---\nname: pdf\n---\nPDF skill\n" })
})

test("plugins: array entries with version, objects, '-' disabled, and local files", async () => {
  const items = await opencode.list("plugin", v2)
  const config = join(v2.home, ".config/opencode")
  expect(items.map((item) => [item.name, item.key ?? item.path, item.offIn])).toEqual([
    ["opencode-wakatime", "plugins[0]", undefined],
    ["@acme/oc-tools", "plugins[1]", undefined],
    ["oc-off", "plugins[2]", ["opencode"]],
    ["local-dir", join(config, "plugins/local-dir"), undefined],
    ["local.ts", join(config, "plugins/local.ts"), undefined],
    ["proj.ts", join(v2.project, ".opencode/plugin/proj.ts"), undefined],
  ])
  expect(await opencode.read(items[0]!)).toEqual({
    type: "plugin",
    plugin: { name: "opencode-wakatime", enabled: true, version: "1.2.0", source: "npm" },
  })
  expect(await opencode.read(items[2]!)).toEqual({
    type: "plugin",
    plugin: { name: "oc-off", enabled: false, source: "npm" },
  })
  expect(await opencode.read(items[3]!)).toEqual({
    type: "plugin",
    plugin: { name: "local-dir", enabled: true, source: join(config, "plugins/local-dir") },
  })
  expect((await opencode.list("plugin", v1)).map((item) => item.key)).toEqual(["plugin[0]"])
})

test("malformed JSONC gives no items and no crash", async () => {
  const broken = { home: join(fixtures, "v1-broken/home"), project: join(fixtures, "v1-broken/home/project"), env: {} }
  for (const kind of ["memory", "mcp", "skill", "plugin"] as const) {
    expect(await opencode.list(kind, broken)).toEqual([])
  }
})

const memoryChange = (change: Partial<Change>): Change => ({ kind: "memory", op: "create", target: { harness: "opencode", scope: "project" }, ...change })
const emptyPlan = { edits: [], moves: [], copies: [], removals: [], commands: [], notices: [] }

test("plan create: AGENTS.md at the scope root, with no file there yet", async () => {
  const global = memoryChange({ target: { harness: "opencode", scope: "global" }, name: "AGENTS.md", text: "# rules\n" })
  expect(await opencode.plan(global, v1)).toEqual({
    ...emptyPlan,
    edits: [{ path: join(v1.home, ".config/opencode/AGENTS.md"), before: null, after: "# rules\n" }],
  })
  expect((await opencode.plan(memoryChange({ name: "AGENTS.md" }), v1)).edits).toEqual([
    { path: join(v1.project, "AGENTS.md"), before: null, after: "" },
  ])
})

test("plan create refuses a name outside memoryFiles and an existing file", async () => {
  await expect(opencode.plan(memoryChange({ name: "CLAUDE.md" }), v1)).rejects.toThrow("CLAUDE.md")
  await expect(opencode.plan(memoryChange({ name: "../AGENTS.md" }), v1)).rejects.toThrow()
  await expect(opencode.plan(memoryChange({ name: "AGENTS.md" }), v2)).rejects.toThrow("already exists")
})

test("plan update edits the item with its current text; delete removes it", async () => {
  const [item] = await opencode.list("memory", v2)
  expect(await opencode.plan(memoryChange({ op: "update", item, text: "# new\n" }), v2)).toEqual({
    ...emptyPlan,
    edits: [{ path: item!.path, before: "# global agents\n", after: "# new\n" }],
  })
  expect(await opencode.plan(memoryChange({ op: "delete", item }), v2)).toEqual({ ...emptyPlan, removals: [item!.path] })
})

test("plan refuses read-only items and kinds other than memory", async () => {
  const [item] = await opencode.list("memory", v2)
  const readOnly = { ...item!, readOnly: "imported from Codex" }
  await expect(opencode.plan(memoryChange({ op: "update", item: readOnly, text: "x" }), v2)).rejects.toThrow("imported from Codex")
  await expect(opencode.plan(memoryChange({ op: "delete", item: readOnly }), v2)).rejects.toThrow("imported from Codex")
  await expect(opencode.plan(memoryChange({ kind: "skill" }), v2)).rejects.toThrow("OpenCode: skill changes are not supported yet")
})

test("memoryFiles names AGENTS.md for both scopes", () => {
  expect(opencode.memoryFiles).toEqual({ global: ["AGENTS.md"], project: ["AGENTS.md"] })
})

test("skillRoots lists every scanned root; env opt-outs drop the .claude roots", async () => {
  const config = join(v2.home, ".config/opencode")
  const all: { path: string; scope: Scope }[] = [
    { path: join(config, "skills"), scope: "global" },
    { path: join(config, "skill"), scope: "global" },
    { path: join(v2.home, ".claude/skills"), scope: "global" },
    { path: join(v2.home, ".agents/skills"), scope: "global" },
    { path: join(v2.project, ".opencode/skills"), scope: "project" },
    { path: join(v2.project, ".opencode/skill"), scope: "project" },
    { path: join(v2.project, ".claude/skills"), scope: "project" },
    { path: join(v2.project, ".agents/skills"), scope: "project" },
  ]
  expect(await opencode.skillRoots(v2)).toEqual(all)
  const withoutClaude = all.filter((root) => !root.path.endsWith("/.claude/skills"))
  for (const name of ["OPENCODE_DISABLE_CLAUDE_CODE", "OPENCODE_DISABLE_CLAUDE_CODE_SKILLS"]) {
    expect(await opencode.skillRoots(roots("v2", { [name]: "1" }))).toEqual(withoutClaude)
  }
})

// ---- mcp plans (plan never writes, so the fixtures are read in place)

const mcpChange = (change: Partial<Change>): Change => ({ kind: "mcp", op: "create", target: { harness: "opencode", scope: "global" }, ...change })
const stdio = (server: Partial<McpServer> = {}): McpServer => ({ name: "fs", transport: "stdio", enabled: true, command: "npx", args: ["-y", "fs-mcp"], native: {}, ...server })
const restart = ["Restart OpenCode to load this change."]
const afterOf = async (change: Change, r: Roots) => {
  const plan = await opencode.plan(change, r)
  expect(plan.notices).toEqual(restart)
  expect(plan.edits).toHaveLength(1)
  return plan.edits[0]!
}
const mcpItem = async (r: Roots, key: string, scope: Scope = "global") =>
  (await opencode.list("mcp", r)).find((item) => item.key === key && item.scope === scope)!

test("plan mcp update v2: comments survive, env refs become {env:VAR}, native kept, disabled dropped when on", async () => {
  const item = await mcpItem(v2, "mcp.servers.fs")
  const server = stdio({ env: { ROOT: "${HOME}/code" }, native: { timeout: 5000, type: "bogus", disabled: true } })
  const edit = await afterOf(mcpChange({ op: "update", item, server }), v2)
  expect(edit.path).toBe(item.path)
  expect(edit.before).toContain("// global v2 config")
  expect(edit.after).toContain("// global v2 config")
  const data = parse(edit.after!)
  expect(data.mcp.servers.fs).toEqual({ timeout: 5000, type: "local", command: ["npx", "-y", "fs-mcp"], environment: { ROOT: "{env:HOME}/code" } })
  expect(Object.keys(data.mcp.servers)).toEqual(["linear", "fs"])
})

test("plan mcp v2 off writes disabled: true; v1 off writes enabled: false and on omits it", async () => {
  const fs = await mcpItem(v2, "mcp.servers.fs")
  const v2Off = await afterOf(mcpChange({ op: "update", item: fs, server: stdio({ enabled: false }) }), v2)
  expect(parse(v2Off.after!).mcp.servers.fs).toEqual({ type: "local", command: ["npx", "-y", "fs-mcp"], disabled: true })
  const github = await mcpItem(v1, "mcp.github")
  const remote: McpServer = { name: "github", transport: "http", enabled: false, url: "https://gh.example/mcp", headers: { Authorization: "Bearer ${GH_TOKEN}" }, native: {} }
  const v1Off = await afterOf(mcpChange({ op: "update", item: github, server: remote }), v1)
  expect(v1Off.after).toContain("// global v1 config")
  expect(parse(v1Off.after!).mcp.github).toEqual({ type: "remote", url: "https://gh.example/mcp", headers: { Authorization: "Bearer {env:GH_TOKEN}" }, enabled: false })
  const v1On = await afterOf(mcpChange({ op: "update", item: github, server: { ...remote, enabled: true } }), v1)
  expect(parse(v1On.after!).mcp.github.enabled).toBeUndefined()
})

test("plan mcp rename removes the old key and adds the new one; delete removes the key", async () => {
  const item = await mcpItem(v2, "mcp.servers.fs")
  const renamed = parse((await afterOf(mcpChange({ op: "update", item, server: stdio({ name: "files" }) }), v2)).after!)
  expect(Object.keys(renamed.mcp.servers)).toEqual(["linear", "files"])
  const deleted = await afterOf(mcpChange({ op: "delete", item }), v2)
  expect(deleted.after).toContain("// global v2 config")
  expect(Object.keys(parse(deleted.after!).mcp.servers)).toEqual(["linear"])
})

test("plan mcp create adds to the existing global file in its shape and refuses a taken name", async () => {
  const edit = await afterOf(mcpChange({ server: stdio({ name: "new" }) }), v2)
  expect(edit.path).toBe(join(v2.home, ".config/opencode/opencode.jsonc"))
  expect(parse(edit.after!).mcp.servers.new).toEqual({ type: "local", command: ["npx", "-y", "fs-mcp"] })
  const project = await afterOf(mcpChange({ target: { harness: "opencode", scope: "project" }, server: stdio({ name: "new" }) }), v1)
  expect(project.path).toBe(join(v1.project, "opencode.jsonc"))
  expect(parse(project.after!).mcp.new).toEqual({ type: "local", command: ["npx", "-y", "fs-mcp"] })
  await expect(opencode.plan(mcpChange({ server: stdio({ name: "linear" }) }), v2)).rejects.toThrow("linear already exists")
})

test("plan mcp create in a new file takes the shape from OPENCODE_VERSION: 1.x is v1, otherwise v2", async () => {
  const home = mkdtempSync(join(tmpdir(), "opencode-"))
  const fresh = (version: string): Roots => ({ home, project: join(home, "project"), env: { OPENCODE_VERSION: version } })
  const v1Edit = await afterOf(mcpChange({ server: stdio({ name: "new" }) }), fresh("1.4.2"))
  expect(v1Edit.path).toBe(join(home, ".config/opencode/opencode.json"))
  expect(v1Edit.before).toBeNull()
  expect(parse(v1Edit.after!)).toEqual({ mcp: { new: { type: "local", command: ["npx", "-y", "fs-mcp"] } } })
  const target = { harness: "opencode" as const, scope: "project" as const }
  const v2Edit = await afterOf(mcpChange({ target, server: stdio({ name: "new" }) }), fresh("2.0.0"))
  expect(v2Edit.path).toBe(join(home, "project/opencode.json"))
  expect(parse(v2Edit.after!)).toEqual({ mcp: { servers: { new: { type: "local", command: ["npx", "-y", "fs-mcp"] } } } })
  rmSync(home, { recursive: true, force: true })
})

test("plan mcp refuses read-only items", async () => {
  const item = { ...(await mcpItem(v2, "mcp.servers.fs")), readOnly: "imported from Codex" }
  await expect(opencode.plan(mcpChange({ op: "delete", item }), v2)).rejects.toThrow("imported from Codex")
  await expect(opencode.plan(mcpChange({ op: "update", item, server: stdio() }), v2)).rejects.toThrow("imported from Codex")
})

// ---- plugin plans (plan never writes, so the fixtures are read in place)

const pluginChange = (change: Partial<Change>): Change => ({ kind: "plugin", op: "create", target: { harness: "opencode", scope: "global" }, ...change })
const npm = (plugin: Partial<PluginInfo> = {}): PluginInfo => ({ name: "oc-new", enabled: true, source: "npm", ...plugin })
const pluginNotice = ["Restart OpenCode to load this change; it installs npm plugins at start-up."]
const pluginEdit = async (change: Change, r: Roots) => {
  const plan = await opencode.plan(change, r)
  expect(plan.notices).toEqual(pluginNotice)
  expect(plan.edits).toHaveLength(1)
  return plan.edits[0]!
}
const pluginItem = async (r: Roots, keyOrName: string) =>
  (await opencode.list("plugin", r)).find((item) => item.key === keyOrName || (!item.key && item.name === keyOrName))!

test("plan plugin install appends name@version to the v2 plugins array, comments kept", async () => {
  const edit = await pluginEdit(pluginChange({ plugin: npm({ version: "2.1.0" }) }), v2)
  expect(edit.path).toBe(join(v2.home, ".config/opencode/opencode.jsonc"))
  expect(edit.after).toContain("// global v2 config")
  expect(parse(edit.after!).plugins).toEqual(["opencode-wakatime@1.2.0", { package: "@acme/oc-tools", options: { level: 2 } }, "-oc-off", "oc-new@2.1.0"])
})

test("plan plugin install appends to the v1 plugin array, and adds the array to a project file without one", async () => {
  const edit = await pluginEdit(pluginChange({ plugin: npm() }), v1)
  expect(edit.after).toContain("// global v1 config")
  expect(parse(edit.after!).plugin).toEqual(["oc-v1-plugin", "oc-new"])
  const project = await pluginEdit(pluginChange({ target: { harness: "opencode", scope: "project" }, plugin: npm() }), v1)
  expect(project.path).toBe(join(v1.project, "opencode.jsonc"))
  expect(parse(project.after!).plugin).toEqual(["oc-new"])
})

test("plan plugin install in a new file takes the key from OPENCODE_VERSION: 1.x plugin, otherwise plugins", async () => {
  const home = mkdtempSync(join(tmpdir(), "opencode-"))
  const fresh = (version: string): Roots => ({ home, project: join(home, "project"), env: { OPENCODE_VERSION: version } })
  const v1Edit = await pluginEdit(pluginChange({ plugin: npm() }), fresh("1.4.2"))
  expect(v1Edit.path).toBe(join(home, ".config/opencode/opencode.json"))
  expect(v1Edit.before).toBeNull()
  expect(parse(v1Edit.after!)).toEqual({ plugin: ["oc-new"] })
  expect(parse((await pluginEdit(pluginChange({ plugin: npm() }), fresh("2.0.0"))).after!)).toEqual({ plugins: ["oc-new"] })
  rmSync(home, { recursive: true, force: true })
})

test("plan plugin install refuses a name already in the array, with or without version or '-'", async () => {
  await expect(opencode.plan(pluginChange({ plugin: npm({ name: "opencode-wakatime" }) }), v2)).rejects.toThrow("opencode-wakatime is already in")
  await expect(opencode.plan(pluginChange({ plugin: npm({ name: "@acme/oc-tools" }) }), v2)).rejects.toThrow("already in")
  await expect(opencode.plan(pluginChange({ plugin: npm({ name: "oc-off" }) }), v2)).rejects.toThrow("already in")
})

test("plan plugin uninstall removes the array element; a local plugin file or folder is removed", async () => {
  const edit = await pluginEdit(pluginChange({ op: "delete", item: await pluginItem(v2, "plugins[1]") }), v2)
  expect(edit.after).toContain("// global v2 config")
  expect(parse(edit.after!).plugins).toEqual(["opencode-wakatime@1.2.0", "-oc-off"])
  const first = await pluginEdit(pluginChange({ op: "delete", item: await pluginItem(v2, "plugins[0]") }), v2)
  expect(parse(first.after!).plugins).toEqual([{ package: "@acme/oc-tools", options: { level: 2 } }, "-oc-off"])
  const only = await pluginEdit(pluginChange({ op: "delete", item: await pluginItem(v1, "plugin[0]") }), v1)
  expect(parse(only.after!).plugin).toEqual([])
  const local = await pluginItem(v2, "local-dir")
  expect(await opencode.plan(pluginChange({ op: "delete", item: local }), v2)).toEqual({ ...emptyPlan, removals: [local.path], notices: pluginNotice })
})

test("plan plugin v2 toggles in place: off rewrites the entry as '-name', on removes the '-'", async () => {
  const wakatime = await pluginItem(v2, "plugins[0]")
  const off = await pluginEdit(pluginChange({ op: "update", item: wakatime, plugin: npm({ name: "opencode-wakatime", version: "1.2.0", enabled: false }) }), v2)
  expect(parse(off.after!).plugins).toEqual(["-opencode-wakatime@1.2.0", { package: "@acme/oc-tools", options: { level: 2 } }, "-oc-off"])
  const ocOff = await pluginItem(v2, "plugins[2]")
  const on = await pluginEdit(pluginChange({ op: "update", item: ocOff, plugin: npm({ name: "oc-off" }) }), v2)
  expect(parse(on.after!).plugins).toEqual(["opencode-wakatime@1.2.0", { package: "@acme/oc-tools", options: { level: 2 } }, "oc-off"])
})

test("plan plugin toggle refuses v1 and local plugin files", async () => {
  const v1Plugin = await pluginItem(v1, "plugin[0]")
  await expect(opencode.plan(pluginChange({ op: "update", item: v1Plugin, plugin: npm({ name: "oc-v1-plugin", enabled: false }) }), v1)).rejects.toThrow(
    "OpenCode 1.x cannot turn a plugin off; uninstall it instead",
  )
  const local = await pluginItem(v2, "local.ts")
  await expect(opencode.plan(pluginChange({ op: "update", item: local, plugin: npm({ name: "local.ts", enabled: false }) }), v2)).rejects.toThrow("local plugin file")
})

test("plan plugin version update replaces the entry; an object entry keeps its options, a '-' entry stays off", async () => {
  const wakatime = await pluginEdit(pluginChange({ op: "update", item: await pluginItem(v2, "plugins[0]"), plugin: npm({ name: "opencode-wakatime", version: "1.3.0" }) }), v2)
  expect(parse(wakatime.after!).plugins[0]).toBe("opencode-wakatime@1.3.0")
  const tools = await pluginEdit(pluginChange({ op: "update", item: await pluginItem(v2, "plugins[1]"), plugin: npm({ name: "@acme/oc-tools", version: "3.0.0" }) }), v2)
  expect(parse(tools.after!).plugins[1]).toEqual({ package: "@acme/oc-tools@3.0.0", options: { level: 2 } })
  const ocOff = await pluginEdit(pluginChange({ op: "update", item: await pluginItem(v2, "plugins[2]"), plugin: npm({ name: "oc-off", version: "0.9.0", enabled: false }) }), v2)
  expect(parse(ocOff.after!).plugins[2]).toBe("-oc-off@0.9.0")
  const v1Edit = await pluginEdit(pluginChange({ op: "update", item: await pluginItem(v1, "plugin[0]"), plugin: npm({ name: "oc-v1-plugin", version: "2.0.0" }) }), v1)
  expect(parse(v1Edit.after!).plugin).toEqual(["oc-v1-plugin@2.0.0"])
})

test("plan plugin refuses read-only items", async () => {
  const item = { ...(await pluginItem(v2, "plugins[0]")), readOnly: "imported from Codex" }
  await expect(opencode.plan(pluginChange({ op: "delete", item }), v2)).rejects.toThrow("imported from Codex")
})
