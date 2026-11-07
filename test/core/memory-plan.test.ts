import { expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Change, Item } from "../../src/core/model"
import { planMemoryFile } from "../../src/core/memory-plan"

const root = mkdtempSync(join(tmpdir(), "memory-plan-"))
const options = { label: "Codex", scopeRoot: () => root, memoryFiles: { global: ["AGENTS.md", "rules/<name>.md"] } }
const target = { harness: "codex", scope: "global" } as const
const item = (path: string, extra: Partial<Item> = {}): Item => ({ kind: "memory", harness: "codex", scope: "global", name: "x", path, loadedBy: ["codex"], ...extra })

test("create writes a new file named in memoryFiles, with <name> filled", async () => {
  const change: Change = { kind: "memory", op: "create", target, name: "rules/testing.md", text: "Run bun test.\n" }
  const plan = await planMemoryFile(change, options)
  expect(plan.edits).toEqual([{ path: join(root, "rules/testing.md"), before: null, after: "Run bun test.\n" }])
})

test("create refuses names outside memoryFiles, unsafe <name> values and existing files", async () => {
  writeFileSync(join(root, "AGENTS.md"), "old\n")
  const create = (name: string): Change => ({ kind: "memory", op: "create", target, name })
  await expect(planMemoryFile(create("NOTES.md"), options)).rejects.toThrow("Codex: NOTES.md is not a global memory file")
  await expect(planMemoryFile(create("rules/../x.md"), options)).rejects.toThrow("is not a global memory file")
  await expect(planMemoryFile(create("AGENTS.md"), options)).rejects.toThrow("already exists")
})

test("update reads the current text; delete moves the file to the backup", async () => {
  const path = join(root, "AGENTS.md")
  writeFileSync(path, "old\n")
  const update = await planMemoryFile({ kind: "memory", op: "update", target, item: item(path), text: "new\n" }, options)
  expect(update.edits).toEqual([{ path, before: "old\n", after: "new\n" }])
  const remove = await planMemoryFile({ kind: "memory", op: "delete", target, item: item(path) }, options)
  expect(remove.removals).toEqual([path])
})

test("read-only items and move are refused", async () => {
  const path = join(root, "AGENTS.md")
  await expect(planMemoryFile({ kind: "memory", op: "delete", target, item: item(path, { readOnly: "managed policy" }) }, options)).rejects.toThrow("read-only (managed policy)")
  await expect(planMemoryFile({ kind: "memory", op: "move", target, item: item(path) }, options)).rejects.toThrow("Codex: memory files cannot move")
})
