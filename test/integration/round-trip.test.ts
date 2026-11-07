import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ADAPTERS } from "../../src/adapters"
import { applyPlan } from "../../src/core/apply"
import type { Change, HarnessId, McpServer, Roots, Scope } from "../../src/core/model"
import { listItems, mergePlans, planChange } from "../../src/core/registry"

// Plans with the real adapters, applies in a temp home, then lists the server back from each harness.
test("one MCP server added to all four harnesses is listed back by each of them", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "round-trip-")))
  const project = join(home, "repo")
  for (const dir of [".claude", ".codex", ".config/opencode", ".omp/agent", "repo/.git"]) mkdirSync(join(home, dir), { recursive: true })
  const roots: Roots = { home, project, env: { OPENCODE_VERSION: "2.0.0" } }
  const server: McpServer = { name: "linear", transport: "http", enabled: true, url: "https://mcp.linear.app/mcp", headers: { Authorization: "Bearer ${LINEAR_TOKEN}" }, native: {} }
  const targets: [HarnessId, Scope][] = [["claude-code", "project"], ["codex", "global"], ["opencode", "global"], ["omp", "global"]]
  const changes: Change[] = targets.map(([harness, scope]) => ({ kind: "mcp", op: "create", target: { harness, scope }, server }))
  const plan = mergePlans(await Promise.all(changes.map((change) => planChange(ADAPTERS, change, roots))))
  expect(plan.commands).toEqual([])
  await applyPlan(plan, { backupRoot: join(home, "backups") })

  const items = (await listItems(ADAPTERS, "mcp", roots)).filter((item) => item.name === "linear")
  expect(items.map((item) => item.harness).sort()).toEqual(["claude-code", "codex", "omp", "opencode"])
  for (const item of items) {
    const detail = await ADAPTERS.find((adapter) => adapter.id === item.harness)!.read(item)
    expect(detail.type === "mcp" && detail.server).toMatchObject({ url: server.url, headers: { Authorization: "Bearer ${LINEAR_TOKEN}" } })
  }
})
