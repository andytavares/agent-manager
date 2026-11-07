import { expect, test } from "bun:test"
import type { HarnessAdapter, HarnessId, Item, Kind, Roots, Scope } from "../../src/core/model"
import { listItems, maskSecret } from "../../src/core/registry"

const roots: Roots = { home: "/home/u", project: "/home/u/repo", env: {} }

function fakeAdapter(
  id: HarnessId,
  items: Item[],
  options: { detected?: boolean; imports?: { harness: HarnessId; scope: Scope }[] } = {},
): HarnessAdapter {
  return {
    id,
    label: id,
    scopes: ["global", "project"],
    detect: async () => options.detected ?? true,
    list: async (kind: Kind) => items.filter((item) => item.kind === kind),
    read: async () => ({ type: "text", text: "" }),
    importsMcpFrom: options.imports ? async () => options.imports! : undefined,
  }
}

function item(fields: Partial<Item> & Pick<Item, "harness" | "name">): Item {
  return { kind: "memory", scope: "global", path: `/home/u/${fields.name}`, loadedBy: [fields.harness], ...fields }
}

test("merges copies with the same kind, path and key", async () => {
  const agents = { name: "AGENTS.md", path: "/home/u/repo/AGENTS.md", scope: "project" as const }
  const items = await listItems(
    [
      fakeAdapter("codex", [item({ ...agents, harness: "codex", readOnly: "managed", warnings: ["big", "old"] })]),
      fakeAdapter("opencode", [item({ ...agents, harness: "opencode", offIn: ["codex", "omp"], warnings: ["old"] })]),
      fakeAdapter("omp", [item({ ...agents, harness: "omp", readOnly: "imported", loadedBy: [] , offIn: ["omp"] })]),
    ],
    "memory",
    roots,
  )
  expect(items).toHaveLength(1)
  expect(items[0]!.harness).toBe("codex")
  expect(items[0]!.loadedBy).toEqual(["codex", "opencode"])
  expect(items[0]!.offIn).toEqual(["omp"])
  expect(items[0]!.readOnly).toBeUndefined()
  expect(items[0]!.warnings).toEqual(["big", "old"])
})

test("keeps readOnly when every copy is read-only, and keeps items with other keys apart", async () => {
  const path = "/home/u/.claude.json"
  const items = await listItems(
    [
      fakeAdapter("claude-code", [
        item({ kind: "mcp", harness: "claude-code", name: "linear", path, key: "mcpServers.linear", readOnly: "a" }),
        item({ kind: "mcp", harness: "claude-code", name: "github", path, key: "mcpServers.github" }),
      ]),
      fakeAdapter("omp", [item({ kind: "mcp", harness: "omp", name: "linear", path, key: "mcpServers.linear", readOnly: "b" })]),
    ],
    "mcp",
    roots,
  )
  expect(items.map((i) => i.name)).toEqual(["github", "linear"])
  expect(items[1]!.readOnly).toBe("a")
})

test("skips adapters that are not detected", async () => {
  const items = await listItems(
    [fakeAdapter("codex", [item({ harness: "codex", name: "a" })], { detected: false })],
    "memory",
    roots,
  )
  expect(items).toEqual([])
})

test("adds an importing harness to loadedBy of MCP items whose harness and scope match", async () => {
  const items = await listItems(
    [
      fakeAdapter("claude-code", [
        item({ kind: "mcp", harness: "claude-code", name: "linear", scope: "global" }),
        item({ kind: "mcp", harness: "claude-code", name: "sentry", scope: "project", offIn: ["omp"] }),
      ]),
      fakeAdapter("codex", [item({ kind: "mcp", harness: "codex", name: "playwright", scope: "global" })]),
      fakeAdapter("omp", [], { imports: [{ harness: "claude-code", scope: "project" }] }),
    ],
    "mcp",
    roots,
  )
  const byName = Object.fromEntries(items.map((i) => [i.name, i]))
  expect(byName.sentry!.loadedBy).toEqual(["claude-code", "omp"])
  expect(byName.sentry!.offIn).toEqual([])
  expect(byName.linear!.loadedBy).toEqual(["claude-code"])
  expect(byName.playwright!.loadedBy).toEqual(["codex"])
})

test("sorts by name, then harness order", async () => {
  const items = await listItems(
    [
      fakeAdapter("omp", [item({ harness: "omp", name: "b", path: "/x" })]),
      fakeAdapter("codex", [item({ harness: "codex", name: "b", path: "/y" }), item({ harness: "codex", name: "a" })]),
    ],
    "memory",
    roots,
  )
  expect(items.map((i) => `${i.name}:${i.harness}`)).toEqual(["a:codex", "b:codex", "b:omp"])
})

test("maskSecret keeps env references and hides literal values", () => {
  expect(maskSecret("${LINEAR_TOKEN}")).toBe("${LINEAR_TOKEN}")
  expect(maskSecret("Bearer ${LINEAR_TOKEN}")).toBe("Bearer ${LINEAR_TOKEN}")
  expect(maskSecret("Bearer sk-live-123")).toBe("••••••••")
  expect(maskSecret("")).toBe("••••••••")
})
