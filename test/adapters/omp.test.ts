import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse } from "jsonc-parser"
import { omp } from "../../src/adapters/omp"
import type { Change, Item, Kind, McpServer, Roots, Scope } from "../../src/core/model"

// A temp copy, because git cannot commit the .git folder and the empty .omp folder the walk-up needs.
let base: string
let home: string
let repo: string
let project: string
let agentDir: string

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "omp-"))
  cpSync(join(import.meta.dir, "../fixtures/omp"), base, { recursive: true })
  home = join(base, "home")
  repo = join(base, "repo")
  project = join(repo, "pkg")
  agentDir = join(home, ".omp/agent")
  mkdirSync(join(repo, ".git"))
  mkdirSync(join(repo, "bare/.omp"))
})

afterAll(() => rmSync(base, { recursive: true, force: true }))

beforeEach(() => rmSync(join(agentDir, "config.yml"), { force: true }))

const globalConfig = (yaml: string) => writeFileSync(join(agentDir, "config.yml"), yaml)
const roots = (overrides: Partial<Roots> = {}): Roots => ({ home, project, env: {}, ...overrides })
const list = (kind: Kind, r = roots()) => omp.list(kind, r)
const byPath = (items: Item[], path: string) => items.find((i) => i.path === path)
const on = (item: Item | undefined) => item?.loadedBy.includes("omp") && !item.offIn
const off = (item: Item | undefined) => item?.offIn?.includes("omp") && !item.loadedBy.includes("omp")

test("detects the agent dir and misses an empty home", async () => {
  expect(await omp.detect(roots())).toBe(true)
  expect(await omp.detect(roots({ home: join(base, "absent") }))).toBe(false)
})

test("lists native global memory and the nearest non-empty .omp memory", async () => {
  const items = await list("memory")
  const summary = items.map((i) => [i.scope, i.name, i.path])
  expect(summary).toContainEqual(["global", "AGENTS.md", join(agentDir, "AGENTS.md")])
  expect(summary).toContainEqual(["global", "RULES.md", join(agentDir, "RULES.md")])
  expect(summary).toContainEqual(["project", ".omp/AGENTS.md", join(project, ".omp/AGENTS.md")])
  // pkg/.omp is non-empty, so repo/.omp is not reached
  expect(byPath(items, join(repo, ".omp/AGENTS.md"))).toBeUndefined()
  expect(items.every((i) => i.harness === "omp")).toBe(true)
})

test("walks past an empty .omp to the repo's .omp", async () => {
  const items = await list("memory", roots({ project: join(repo, "bare") }))
  expect(on(byPath(items, join(repo, ".omp/AGENTS.md")))).toBe(true)
  expect(on(byPath(items, join(repo, ".omp/RULES.md")))).toBe(true)
})

test("loads foreign project CLAUDE.md and AGENTS.md up to the repo root", async () => {
  const items = await list("memory")
  expect(on(byPath(items, join(project, "CLAUDE.md")))).toBe(true)
  expect(on(byPath(items, join(project, ".claude/CLAUDE.md")))).toBe(true)
  expect(on(byPath(items, join(repo, "CLAUDE.md")))).toBe(true)
  expect(on(byPath(items, join(repo, "AGENTS.md")))).toBe(true)
  expect(byPath(items, join(project, "CLAUDE.md"))!.scope).toBe("project")
})

test("user CLAUDE.md is off by default and on with enabledProviders", async () => {
  const userClaude = join(home, ".claude/CLAUDE.md")
  const before = byPath(await list("memory"), userClaude)
  expect(before?.scope).toBe("global")
  expect(before).toMatchObject({ loadedBy: [], offIn: ["omp"] })
  globalConfig("enabledProviders:\n  - claude\n")
  expect(on(byPath(await list("memory"), userClaude))).toBe(true)
})

test("disabledProviders turns a project source off", async () => {
  globalConfig("disabledProviders: [claude-md]\n")
  const items = await list("memory")
  expect(off(byPath(items, join(project, "CLAUDE.md")))).toBe(true)
  expect(on(byPath(items, join(project, ".claude/CLAUDE.md")))).toBe(true)
})

test("lists MCP servers from both mcp.json files with keys", async () => {
  const items = await list("mcp")
  const userFile = join(agentDir, "mcp.json")
  const projectFile = join(project, ".omp/mcp.json")
  expect(items.map((i) => [i.scope, i.name, i.path, i.key])).toEqual([
    ["global", "github", userFile, "mcpServers.github"],
    ["global", "fs", userFile, "mcpServers.fs"],
    ["global", "muted", userFile, "mcpServers.muted"],
    ["global", "paused", userFile, "mcpServers.paused"],
    ["project", "db", projectFile, "mcpServers.db"],
    ["project", "shared", projectFile, "mcpServers.shared"],
  ])
})

test("disabledServers and enabled: false turn servers off", async () => {
  const items = await list("mcp")
  const named = (name: string) => items.find((i) => i.name === name)
  expect(on(named("github"))).toBe(true)
  expect(on(named("db"))).toBe(true)
  expect(off(named("muted"))).toBe(true)
  expect(off(named("paused"))).toBe(true)
  expect(off(named("shared"))).toBe(true)
})

test("reads an MCP server into transport fields and native keys", async () => {
  const items = await list("mcp")
  const named = (name: string) => items.find((i) => i.name === name)!
  expect(await omp.read(named("github"))).toEqual({
    type: "mcp",
    server: {
      name: "github",
      transport: "http",
      enabled: true,
      url: "https://api.githubcopilot.com/mcp/",
      headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
      native: { timeout: 5000 },
    },
  })
  expect(await omp.read(named("fs"))).toEqual({
    type: "mcp",
    server: {
      name: "fs",
      transport: "stdio",
      enabled: true,
      command: "npx",
      args: ["-y", "fs-mcp"],
      env: { ROOT: "/tmp" },
      native: { cwd: "/work" },
    },
  })
  const paused = await omp.read(named("paused"))
  expect(paused.type === "mcp" && paused.server.enabled).toBe(false)
})

test("imports project MCP sources by default and user sources only when enabled", async () => {
  expect(await omp.importsMcpFrom!(roots())).toEqual([
    { harness: "claude-code", scope: "project" },
    { harness: "claude-code", scope: "local" },
    { harness: "codex", scope: "project" },
    { harness: "opencode", scope: "project" },
  ])
  globalConfig("enabledProviders: [claude, opencode]\n")
  const enabled = await omp.importsMcpFrom!(roots())
  expect(enabled).toContainEqual({ harness: "claude-code", scope: "global" })
  expect(enabled).toContainEqual({ harness: "opencode", scope: "global" })
  expect(enabled).not.toContainEqual({ harness: "codex", scope: "global" })
  globalConfig("enabledProviders: ['*']\ndisabledProviders: [claude]\n")
  const disabled = await omp.importsMcpFrom!(roots())
  expect(disabled.some((s) => s.harness === "claude-code")).toBe(false)
  expect(disabled).toContainEqual({ harness: "codex", scope: "global" })
})

test("lists native, managed and foreign skill roots with gating", async () => {
  const items = await list("skill")
  const named = (name: string) => items.find((i) => i.name === name)
  expect(on(named("native-skill"))).toBe(true)
  expect(named("native-skill")!.path).toBe(join(agentDir, "skills/native-skill"))
  expect(on(named("learned"))).toBe(true)
  expect(on(named("proj-skill"))).toBe(true)
  expect(named("proj-skill")!.scope).toBe("project")
  expect(on(named("claude-proj"))).toBe(true)
  expect(on(named("agents-proj"))).toBe(true)
  // .agents user sources load by default; claude user sources are opt-in
  expect(on(named("agents-user"))).toBe(true)
  expect(off(named("claude-user"))).toBe(true)
  globalConfig("enabledProviders: [claude]\n")
  expect(on((await list("skill")).find((i) => i.name === "claude-user"))).toBe(true)
  globalConfig("enabledProviders: [claude]\nskills:\n  enableClaudeUser: false\n")
  expect(off((await list("skill")).find((i) => i.name === "claude-user"))).toBe(true)
})

test("ignoredSkills turns matching skills off", async () => {
  const items = await list("skill")
  expect(off(items.find((i) => i.name === "ignored-one"))).toBe(true)
})

test("reads a skill as text", async () => {
  const skill = (await list("skill")).find((i) => i.name === "native-skill")!
  expect(await omp.read(skill)).toEqual({ type: "text", text: "---\nname: native-skill\n---\nNative\n" })
})

test("lists marketplace and npm plugins with lockfile and override state", async () => {
  const items = await list("plugin")
  const named = (name: string) => items.find((i) => i.name === name)
  const userRoot = join(home, ".omp/plugins")
  expect(named("code-review@claude-plugins-official")).toMatchObject({
    scope: "global",
    path: join(userRoot, "installed_plugins.json"),
    key: "plugins.code-review@claude-plugins-official",
  })
  expect(named("omp-lint")).toMatchObject({ scope: "global", path: join(userRoot, "package.json") })
  expect(named("docs@team")).toMatchObject({ scope: "project", path: join(project, ".omp/plugins/installed_plugins.json") })
  expect(on(named("omp-lint"))).toBe(true)
  expect(off(named("omp-off"))).toBe(true)
  expect(off(named("omp-masked"))).toBe(true)
  expect(await omp.read(named("code-review@claude-plugins-official")!)).toEqual({
    type: "plugin",
    plugin: { name: "code-review@claude-plugins-official", enabled: true, version: "1.4.0", source: "claude-plugins-official" },
  })
  expect(await omp.read(named("omp-off")!)).toEqual({
    type: "plugin",
    plugin: { name: "omp-off", enabled: false, version: "2.0.0", source: "npm" },
  })
})

test("PI_CODING_AGENT_DIR and OMP_PROFILE move the agent dir", async () => {
  const custom = join(home, "custom-agent")
  const viaEnv = await list("memory", roots({ env: { PI_CODING_AGENT_DIR: custom } }))
  expect(byPath(viaEnv, join(custom, "AGENTS.md"))?.scope).toBe("global")
  expect(byPath(viaEnv, join(agentDir, "AGENTS.md"))).toBeUndefined()
  const profile = join(home, ".omp/profiles/work/agent")
  const viaProfile = await list("memory", roots({ env: { OMP_PROFILE: "work", PI_CODING_AGENT_DIR: custom } }))
  expect(byPath(viaProfile, join(profile, "AGENTS.md"))?.scope).toBe("global")
  expect(byPath(viaProfile, join(custom, "AGENTS.md"))).toBeUndefined()
})

test("bad YAML and JSON give no items and no crash", async () => {
  globalConfig("enabledProviders: [claude\n")
  const memory = await list("memory")
  expect(off(byPath(memory, join(home, ".claude/CLAUDE.md")))).toBe(true)
  const broken = join(base, "broken")
  mkdirSync(join(broken, ".omp"), { recursive: true })
  writeFileSync(join(broken, ".omp/mcp.json"), "{ not json")
  writeFileSync(join(broken, ".omp/config.yml"), "skills: [\n")
  const mcp = await list("mcp", roots({ project: broken }))
  expect(mcp.some((i) => i.scope === "project")).toBe(false)
})

const memoryChange = (change: Partial<Change>): Change => ({ kind: "memory", op: "create", target: { harness: "omp", scope: "project" }, ...change })
const emptyPlan = { edits: [], moves: [], copies: [], removals: [], commands: [], notices: [] }

test("plan create: AGENTS.md or RULES.md in the agent dir or the project .omp", async () => {
  expect(await omp.plan(memoryChange({ name: "RULES.md", text: "# rules\n" }), roots())).toEqual({
    ...emptyPlan,
    edits: [{ path: join(project, ".omp/RULES.md"), before: null, after: "# rules\n" }],
  })
  const fresh = join(base, "fresh-agent")
  const global = memoryChange({ target: { harness: "omp", scope: "global" }, name: "AGENTS.md" })
  expect((await omp.plan(global, roots({ env: { PI_CODING_AGENT_DIR: fresh } }))).edits).toEqual([
    { path: join(fresh, "AGENTS.md"), before: null, after: "" },
  ])
})

test("plan create refuses a name outside memoryFiles and an existing file", async () => {
  await expect(omp.plan(memoryChange({ name: "CLAUDE.md" }), roots())).rejects.toThrow("CLAUDE.md")
  await expect(omp.plan(memoryChange({ name: "AGENTS.md" }), roots())).rejects.toThrow("already exists")
})

test("plan update edits the item with its current text; delete removes it", async () => {
  const item = byPath(await list("memory"), join(agentDir, "AGENTS.md"))!
  const before = await Bun.file(item.path).text()
  expect(await omp.plan(memoryChange({ op: "update", item, text: "# new\n" }), roots())).toEqual({
    ...emptyPlan,
    edits: [{ path: item.path, before, after: "# new\n" }],
  })
  expect(await omp.plan(memoryChange({ op: "delete", item }), roots())).toEqual({ ...emptyPlan, removals: [item.path] })
})

test("plan refuses read-only items and kinds other than memory", async () => {
  const item = { ...byPath(await list("memory"), join(agentDir, "AGENTS.md"))!, readOnly: "imported from Codex" }
  await expect(omp.plan(memoryChange({ op: "update", item, text: "x" }), roots())).rejects.toThrow("imported from Codex")
  await expect(omp.plan(memoryChange({ op: "delete", item }), roots())).rejects.toThrow("imported from Codex")
  await expect(omp.plan(memoryChange({ kind: "skill" }), roots())).rejects.toThrow("omp: skill changes are not supported yet")
})

test("memoryFiles names AGENTS.md and RULES.md for both scopes", () => {
  expect(omp.memoryFiles).toEqual({ global: ["AGENTS.md", "RULES.md"], project: ["AGENTS.md", "RULES.md"] })
})

type SkillRoot = { path: string; scope: Scope }

test("skillRoots lists turned-on roots, native first", async () => {
  const native: SkillRoot[] = [
    { path: join(agentDir, "skills"), scope: "global" },
    { path: join(agentDir, "managed-skills"), scope: "global" },
    { path: join(project, ".omp/skills"), scope: "project" },
    { path: join(repo, ".omp/skills"), scope: "project" },
  ]
  const agents: SkillRoot = { path: join(home, ".agents/skills"), scope: "global" }
  const projectForeign: SkillRoot[] = [
    { path: join(project, ".claude/skills"), scope: "project" },
    { path: join(project, ".agents/skills"), scope: "project" },
  ]
  expect(await omp.skillRoots(roots())).toEqual([...native, agents, ...projectForeign])
  globalConfig("enabledProviders: [claude]\nskills:\n  enablePiUser: false\n  enableAgentsProject: false\n")
  expect(await omp.skillRoots(roots())).toEqual([
    ...native.slice(1),
    { path: join(home, ".claude/skills"), scope: "global" },
    agents,
    projectForeign[0]!,
  ])
})

test("local memory backend files are listed per project, on only with memory.backend: local", async () => {
  // omp encodes the cwd: strip the leading slash, then / and : become -
  const root = join(agentDir, "memories", `--${project.slice(1).replaceAll("/", "-")}--`)
  mkdirSync(root, { recursive: true })
  for (const file of ["MEMORY.md", "memory_summary.md", "learned.md"]) writeFileSync(join(root, file), `# ${file}\n`)
  const backend = (items: Item[]) => items.filter((i) => i.path.startsWith(root))
  const listed = backend(await list("memory"))
  expect(listed.map((i) => [i.scope, i.name, i.path, i.offIn, i.warnings])).toEqual(
    ["MEMORY.md", "memory_summary.md", "learned.md"].map((file) => [
      "project",
      file,
      join(root, file),
      ["omp"],
      ["omp memory backend file"],
    ]),
  )
  globalConfig("memory:\n  backend: local\n")
  const loaded = backend(await list("memory"))
  expect(loaded.every(on)).toBe(true)
  expect((await omp.plan(memoryChange({ op: "delete", item: loaded[2] }), roots())).removals).toEqual([join(root, "learned.md")])
  rmSync(join(agentDir, "memories"), { recursive: true })
})

// ---- mcp plans

const mcpChange = (change: Partial<Change>): Change => ({ kind: "mcp", op: "create", target: { harness: "omp", scope: "global" }, ...change })
const restart = "Restart omp to load this change."
const expandNotice = "omp may not expand ${VAR} in mcp.json; check the server starts."
const mcpItem = async (name: string, scope: Scope = "global") => (await list("mcp")).find((i) => i.name === name && i.scope === scope)!
const onlyEdit = async (change: Change, r = roots()) => {
  const plan = await omp.plan(change, r)
  expect(plan.edits).toHaveLength(1)
  return { plan, edit: plan.edits[0]! }
}

test("plan mcp update keeps comments and native keys, writes enabled: false, adds the ${VAR} notice", async () => {
  const item = await mcpItem("fs")
  const server: McpServer = { name: "fs", transport: "stdio", enabled: false, command: "npx", args: ["fs-mcp"], env: { ROOT: "${HOME}" }, native: { cwd: "/work", command: "bogus" } }
  const { plan, edit } = await onlyEdit(mcpChange({ op: "update", item, server }))
  expect(edit.path).toBe(join(agentDir, "mcp.json"))
  expect(edit.after).toContain("// user servers")
  expect(parse(edit.after!).mcpServers.fs).toEqual({ cwd: "/work", command: "npx", args: ["fs-mcp"], env: { ROOT: "${HOME}" }, enabled: false })
  expect(plan.notices).toEqual([restart, expandNotice])
})

test("plan mcp remote entry: type, url, headers; no ${VAR} notice for plain values", async () => {
  const item = await mcpItem("shared", "project")
  const server: McpServer = { name: "shared", transport: "http", enabled: false, url: "https://x.example/mcp", headers: { A: "b" }, native: {} }
  const { plan, edit } = await onlyEdit(mcpChange({ op: "update", item, server }))
  expect(edit.path).toBe(join(project, ".omp/mcp.json"))
  expect(parse(edit.after!).mcpServers.shared).toEqual({ type: "http", url: "https://x.example/mcp", headers: { A: "b" } })
  expect(plan.notices).toEqual([restart])
})

test("plan mcp rename replaces the key; delete removes it", async () => {
  const item = await mcpItem("muted")
  const renamed = await onlyEdit(mcpChange({ op: "update", item, server: { name: "quiet", transport: "stdio", enabled: true, command: "muted-mcp", native: {} } }))
  const servers = parse(renamed.edit.after!).mcpServers
  expect(Object.keys(servers)).toEqual(["github", "fs", "paused", "quiet"])
  expect(servers.quiet).toEqual({ command: "muted-mcp" })
  const deleted = await onlyEdit(mcpChange({ op: "delete", item }))
  expect(deleted.edit.after).toContain("// user servers")
  expect(Object.keys(parse(deleted.edit.after!).mcpServers)).toEqual(["github", "fs", "paused"])
})

test("plan mcp create makes a new mcp.json when absent and refuses a taken name", async () => {
  const fresh = join(base, "fresh-mcp")
  const server: McpServer = { name: "db", transport: "stdio", enabled: true, command: "db-mcp", native: {} }
  const { edit } = await onlyEdit(mcpChange({ server }), roots({ env: { PI_CODING_AGENT_DIR: fresh } }))
  expect(edit).toMatchObject({ path: join(fresh, "mcp.json"), before: null })
  expect(parse(edit.after!)).toEqual({ mcpServers: { db: { command: "db-mcp" } } })
  const target = { harness: "omp" as const, scope: "project" as const }
  await expect(omp.plan(mcpChange({ target, server }), roots())).rejects.toThrow("db already exists")
})

test("plan mcp refuses read-only items", async () => {
  const item = { ...(await mcpItem("fs")), readOnly: "imported from Codex" }
  await expect(omp.plan(mcpChange({ op: "delete", item }), roots())).rejects.toThrow("imported from Codex")
})

const pluginChange = (change: Partial<Change>): Change => ({ kind: "plugin", op: "create", target: { harness: "omp", scope: "global" }, ...change })
const pluginItem = async (name: string) => (await list("plugin")).find((i) => i.name === name)!
const pluginFiles = (root: string) => ["installed_plugins.json", "package.json", "omp-plugins.lock.json"].map((file) => join(root, ".omp/plugins", file))
// omp writes npm plugins to the user root whatever --scope says, so every plugin command backs up both roots.
const bothRoots = () => [...pluginFiles(home), ...pluginFiles(project)]
const commandPlan = (argv: string[], touches: string[]) => ({ ...emptyPlan, commands: [{ argv, touches, cwd: project }], notices: [restart] })

test("plan plugin install runs omp plugin install with the target scope", async () => {
  const change = pluginChange({ target: { harness: "omp", scope: "project" }, plugin: { name: "docs@team", enabled: true } })
  expect(await omp.plan(change, roots())).toEqual(commandPlan(["omp", "plugin", "install", "--scope", "project", "docs@team"], bothRoots()))
})

test("plan plugin uninstall, disable and upgrade pass --scope only for marketplace installs", async () => {
  const marketplace = await pluginItem("code-review@claude-plugins-official")
  const npm = await pluginItem("omp-lint")
  expect(await omp.plan(pluginChange({ op: "delete", item: marketplace }), roots())).toEqual(
    commandPlan(["omp", "plugin", "uninstall", "--scope", "user", marketplace.name], bothRoots()),
  )
  const disable = await omp.plan(pluginChange({ op: "update", item: npm, plugin: { name: "omp-lint", enabled: false } }), roots())
  expect(disable).toEqual(commandPlan(["omp", "plugin", "disable", "omp-lint"], bothRoots()))
  const upgrade = await omp.plan(pluginChange({ op: "update", item: marketplace, plugin: { name: marketplace.name, enabled: true, version: "2.0.0" } }), roots())
  expect(upgrade.commands[0]!.argv).toEqual(["omp", "plugin", "upgrade", "--scope", "user", marketplace.name])
})

test("plan plugin enable runs omp plugin enable; a plugin masked by plugin-overrides.json is refused", async () => {
  const lockOff = await pluginItem("omp-off")
  const enable = await omp.plan(pluginChange({ op: "update", item: lockOff, plugin: { name: "omp-off", enabled: true } }), roots())
  expect(enable.commands[0]!.argv).toEqual(["omp", "plugin", "enable", "omp-off"])
  const masked = await pluginItem("omp-masked")
  await expect(omp.plan(pluginChange({ op: "update", item: masked, plugin: { name: "omp-masked", enabled: true } }), roots())).rejects.toThrow(
    `omp: omp-masked is disabled in ${join(project, ".omp/plugin-overrides.json")}`,
  )
})

test("plan marketplace add and remove run omp plugin marketplace", async () => {
  const touches = [join(home, ".omp/marketplaces.json")]
  expect(await omp.plan(pluginChange({ marketplace: "anthropics/claude-plugins-official" }), roots())).toEqual(
    commandPlan(["omp", "plugin", "marketplace", "add", "anthropics/claude-plugins-official"], touches),
  )
  expect((await omp.plan(pluginChange({ op: "delete", marketplace: "team" }), roots())).commands[0]!.argv).toEqual(["omp", "plugin", "marketplace", "remove", "team"])
})

test("plan plugin refuses read-only items", async () => {
  const item = { ...(await pluginItem("omp-lint")), readOnly: "imported from Claude Code" }
  await expect(omp.plan(pluginChange({ op: "delete", item }), roots())).rejects.toThrow("omp: omp-lint is read-only (imported from Claude Code)")
})

test("marketplaces come from ~/.omp/marketplaces.json", async () => {
  expect(await omp.marketplaces!(roots())).toEqual([])
  const registry = join(home, ".omp/marketplaces.json")
  const entry = { sourceType: "github", catalogPath: "/c", addedAt: "", updatedAt: "" }
  writeFileSync(registry, JSON.stringify({ version: 1, marketplaces: [{ ...entry, name: "team", sourceUri: "acme/plugins" }] }))
  try {
    expect(await omp.marketplaces!(roots())).toEqual([{ name: "team", source: "acme/plugins" }])
  } finally {
    rmSync(registry)
  }
})

test("a server held off by disabledServers reads as off; editing it keeps it off without enabled: false", async () => {
  const item = await mcpItem("muted")
  const detail = await omp.read(item)
  expect(detail.type === "mcp" && detail.server.enabled).toBe(false)
  const server = { name: "muted", transport: "stdio" as const, enabled: false, command: "muted-mcp-2", native: {} }
  const { edit } = await onlyEdit(mcpChange({ op: "update", item, server }))
  const after = parse(edit.after!)
  expect(after.mcpServers.muted).toEqual({ command: "muted-mcp-2" })
  expect(after.disabledServers).toEqual(["muted", "shared"])
})

test("turning on a server listed in disabledServers removes it from that list", async () => {
  const item = await mcpItem("muted")
  const server = { name: "muted", transport: "stdio" as const, enabled: true, command: "muted-mcp", native: {} }
  const plan = await omp.plan(mcpChange({ op: "update", item, server }), roots())
  const after = parse(plan.edits.at(-1)!.after!)
  expect(after.disabledServers).toEqual(["shared"])
  expect(after.mcpServers.muted.enabled).toBeUndefined()
})
