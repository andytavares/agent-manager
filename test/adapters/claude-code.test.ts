import { afterAll, beforeAll, expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { claudeCode } from "../../src/adapters/claude-code"
import type { Item, Kind, Roots } from "../../src/core/model"

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
