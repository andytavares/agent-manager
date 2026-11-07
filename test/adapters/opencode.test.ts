import { expect, test } from "bun:test"
import { join } from "node:path"
import { configShape, opencode } from "../../src/adapters/opencode"
import type { Item, Roots } from "../../src/core/model"

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
