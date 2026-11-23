import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { autoMemoryDir } from "../../src/adapters/claude-code"
import type { HarnessAdapter, Item, ItemDetail, Kind, McpServer, Roots } from "../../src/core/model"
import { healthIssues } from "../../src/memory/issues"

const INDEX = "- [Gone](project_gone.md) — the file was deleted\n"
const ORPHAN = "---\nname: project-capex\nmetadata:\n  type: project\n---\n\nNobody indexed me.\n"
const SKILL = "---\nname: deploy\n---\n\nShip it.\n"
const GITHUB: McpServer = {
  name: "github",
  transport: "stdio",
  enabled: true,
  command: "github-mcp",
  env: { GITHUB_TOKEN: "ghp_live_token" },
  native: {},
}

const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "memory-issues-"))
  homes.push(home)
  return home
}

function fakeAdapter(id: "claude-code" | "codex", items: Item[], servers: Record<string, McpServer> = {}): HarnessAdapter {
  return {
    id,
    label: id === "codex" ? "Codex" : "Claude Code",
    scopes: ["global", "project"],
    detect: async () => true,
    list: async (kind: Kind) => items.filter((item) => item.kind === kind),
    read: async (item): Promise<ItemDetail> => {
      const server = servers[item.name]
      if (server) return { type: "mcp", server }
      return { type: "text", text: existsSync(join(item.path, "SKILL.md")) ? readFileSync(join(item.path, "SKILL.md"), "utf8") : "" }
    },
    plan: async () => ({ edits: [], moves: [], copies: [], removals: [], commands: [], notices: [] }),
    memoryFiles: {},
    skillRoots: async () => [],
  }
}

// The files go where the app reads them: Claude Code's auto memory folder for the project.
async function projectMemory(files: Record<string, string>): Promise<{ roots: Roots; dir: string }> {
  const home = tempHome()
  const roots: Roots = { home, project: join(home, "repo"), env: {} }
  const dir = await autoMemoryDir(roots)
  mkdirSync(dir, { recursive: true })
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  return { roots, dir }
}

function memoryItem(dir: string, name: string): Item {
  return { kind: "memory", harness: "claude-code", scope: "project", name, path: join(dir, name), loadedBy: ["claude-code"] }
}

function skillItem(home: string): Item {
  const folder = join(home, ".codex/skills/deploy")
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, "SKILL.md"), SKILL)
  return { kind: "skill", harness: "codex", scope: "global", name: "deploy", path: folder, loadedBy: ["codex"] }
}

function mcpItem(home: string): Item {
  return { kind: "mcp", harness: "claude-code", scope: "global", name: "github", path: join(home, ".claude.json"), key: "mcpServers.github", loadedBy: ["claude-code"] }
}

describe("healthIssues", () => {
  test("reports a skill that fails a harness check, named by the harness", async () => {
    const home = tempHome()
    const skill = skillItem(home)
    const issues = await healthIssues([fakeAdapter("codex", [skill])], { home, project: join(home, "repo"), env: {} })
    expect(issues).toEqual([{ kind: "skill", detail: "Codex: description is required", path: join(skill.path, "SKILL.md") }])
  })

  test("reports a literal MCP env value by the variable name", async () => {
    const home = tempHome()
    const item = mcpItem(home)
    const issues = await healthIssues([fakeAdapter("claude-code", [item], { github: GITHUB })], { home, project: join(home, "repo"), env: {} })
    expect(issues).toEqual([{ kind: "mcp-secret", detail: "GITHUB_TOKEN is a literal value, use ${VAR}", path: item.path }])
  })

  test("lists memory issues before skill and secret issues", async () => {
    const home = tempHome()
    const skill = skillItem(home)
    const secret = mcpItem(home)
    const { roots, dir } = await projectMemory({ "MEMORY.md": INDEX, "project_capex.md": ORPHAN })
    const items = [skill, secret, memoryItem(dir, "MEMORY.md"), memoryItem(dir, "project_capex.md")]
    const adapters = [fakeAdapter("codex", items), fakeAdapter("claude-code", items, { github: GITHUB })]
    const kinds = (await healthIssues(adapters, roots)).map((issue) => issue.kind)
    expect(kinds).toContain("orphan")
    expect(kinds).toContain("dead-index")
    expect(kinds.indexOf("orphan")).toBeLessThan(kinds.indexOf("skill"))
    expect(kinds.indexOf("skill")).toBeLessThan(kinds.indexOf("mcp-secret"))
  })

  test("reports nothing when no harness has anything installed", async () => {
    const home = tempHome()
    expect(await healthIssues([], { home, project: join(home, "repo"), env: {} })).toEqual([])
  })
})
