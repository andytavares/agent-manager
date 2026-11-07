import { beforeEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { applyPlan, CommandError, defaultBackupRoot, StaleFileError } from "../../src/core/apply"
import type { WritePlan } from "../../src/core/model"

let dir: string
let backupRoot: string
const now = new Date(2026, 10, 7, 9, 5, 3)
const stamp = "2026-11-07T09-05-03"

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "apply-"))
  backupRoot = join(dir, "backups")
})

function plan(parts: Partial<WritePlan>): WritePlan {
  return { edits: [], moves: [], removals: [], commands: [], notices: [], ...parts }
}

const read = (path: string) => readFile(path, "utf8")

test("creates, updates and deletes files and returns the notices", async () => {
  const created = join(dir, "new/deep/a.md")
  const updated = join(dir, "b.md")
  const deleted = join(dir, "c.md")
  await writeFile(updated, "old b")
  await writeFile(deleted, "old c")
  const result = await applyPlan(
    plan({
      edits: [
        { path: created, before: null, after: "new a" },
        { path: updated, before: "old b", after: "new b" },
        { path: deleted, before: "old c", after: null },
      ],
      notices: ["Restart"],
    }),
    { backupRoot, now },
  )
  expect(await read(created)).toBe("new a")
  expect(await read(updated)).toBe("new b")
  expect(existsSync(deleted)).toBe(false)
  expect(existsSync(`${updated}.agent-manager.tmp`)).toBe(false)
  expect(result).toEqual({ backupDir: join(backupRoot, stamp), notices: ["Restart"] })
})

test("backup mirrors absolute paths and holds the old text", async () => {
  const updated = join(dir, "b.md")
  await writeFile(updated, "old b")
  const { backupDir } = await applyPlan(plan({ edits: [{ path: updated, before: "old b", after: "new" }] }), {
    backupRoot,
    now,
  })
  expect(await read(join(backupDir, updated))).toBe("old b")
})

test("a stale file aborts before anything is written or backed up", async () => {
  const fresh = join(dir, "fresh.md")
  const stale = join(dir, "stale.md")
  await writeFile(stale, "changed on disk")
  const attempt = applyPlan(
    plan({
      edits: [
        { path: fresh, before: null, after: "x" },
        { path: stale, before: "planned", after: "y" },
      ],
    }),
    { backupRoot, now },
  )
  await expect(attempt).rejects.toBeInstanceOf(StaleFileError)
  await expect(attempt).rejects.toMatchObject({ path: stale })
  expect(existsSync(fresh)).toBe(false)
  expect(await read(stale)).toBe("changed on disk")
  expect(existsSync(backupRoot)).toBe(false)
})

test("previewOnly edits are neither stale-checked nor written", async () => {
  const preview = join(dir, ".claude.json")
  await writeFile(preview, "on disk")
  await applyPlan(plan({ edits: [{ path: preview, before: "other", after: "new", previewOnly: true }] }), {
    backupRoot,
    now,
  })
  expect(await read(preview)).toBe("on disk")
})

test("a removal moves the folder into the backup", async () => {
  const skill = join(dir, "skills/pdf")
  await mkdir(skill, { recursive: true })
  await writeFile(join(skill, "SKILL.md"), "pdf skill")
  const { backupDir } = await applyPlan(plan({ removals: [skill] }), { backupRoot, now })
  expect(existsSync(skill)).toBe(false)
  expect(await read(join(backupDir, skill, "SKILL.md"))).toBe("pdf skill")
})

test("moves a folder and backs up its source", async () => {
  const from = join(dir, "skills/pdf")
  const to = join(dir, "other/skills/pdf")
  await mkdir(from, { recursive: true })
  await writeFile(join(from, "SKILL.md"), "pdf skill")
  const { backupDir } = await applyPlan(plan({ moves: [{ from, to }] }), { backupRoot, now })
  expect(existsSync(from)).toBe(false)
  expect(await read(join(to, "SKILL.md"))).toBe("pdf skill")
  expect(await read(join(backupDir, from, "SKILL.md"))).toBe("pdf skill")
})

test("a move onto an existing target fails before any change", async () => {
  const edited = join(dir, "a.md")
  const from = join(dir, "from.md")
  const to = join(dir, "to.md")
  await writeFile(from, "from")
  await writeFile(to, "to")
  const attempt = applyPlan(plan({ edits: [{ path: edited, before: null, after: "x" }], moves: [{ from, to }] }), {
    backupRoot,
    now,
  })
  await expect(attempt).rejects.toThrow(to)
  expect(existsSync(edited)).toBe(false)
  expect(await read(from)).toBe("from")
  expect(existsSync(backupRoot)).toBe(false)
})

test("commands run in order after their touched files are backed up", async () => {
  const touched = join(dir, ".claude.json")
  await writeFile(touched, "before command")
  const calls: string[][] = []
  const run = async (argv: string[]) => {
    calls.push(argv)
    await writeFile(touched, `after ${argv[1]}`)
    return { code: 0, stderr: "" }
  }
  const { backupDir } = await applyPlan(
    plan({
      commands: [
        { argv: ["claude", "one"], touches: [touched, join(dir, "absent.json")] },
        { argv: ["claude", "two"], touches: [] },
      ],
    }),
    { backupRoot, now, run },
  )
  expect(calls).toEqual([
    ["claude", "one"],
    ["claude", "two"],
  ])
  expect(await read(join(backupDir, touched))).toBe("before command")
  expect(await readdir(join(backupDir, dir))).toEqual([".claude.json"])
})

test("a non-zero exit throws CommandError with stderr and stops later commands", async () => {
  const calls: string[][] = []
  const run = async (argv: string[]) => {
    calls.push(argv)
    return { code: 2, stderr: "boom" }
  }
  const attempt = applyPlan(
    plan({
      commands: [
        { argv: ["claude", "one"], touches: [] },
        { argv: ["claude", "two"], touches: [] },
      ],
    }),
    { backupRoot, now, run },
  )
  await expect(attempt).rejects.toBeInstanceOf(CommandError)
  await expect(attempt).rejects.toMatchObject({ argv: ["claude", "one"], code: 2, stderr: "boom" })
  expect(calls).toEqual([["claude", "one"]])
})

test("the default runner runs a real argv", async () => {
  await applyPlan(plan({ commands: [{ argv: ["true"], touches: [] }] }), { backupRoot, now })
  await expect(applyPlan(plan({ commands: [{ argv: ["false"], touches: [] }] }), { backupRoot, now })).rejects.toBeInstanceOf(
    CommandError,
  )
})

test("defaultBackupRoot uses XDG_STATE_HOME, else ~/.local/state", () => {
  expect(defaultBackupRoot({ home: "/h", project: "/p", env: { XDG_STATE_HOME: "/s" } })).toBe("/s/agent-manager/backups")
  expect(defaultBackupRoot({ home: "/h", project: "/p", env: {} })).toBe("/h/.local/state/agent-manager/backups")
})
