import { beforeEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type CommandRunner } from "../../src/core/apply"
import type { WritePlan } from "../../src/core/model"
import { applyWithUndo, UndoConflictError, undoLast } from "../../src/core/undo"

let dir: string
let stateRoot: string
let backupRoot: string
const now = new Date(2026, 10, 7, 9, 5, 3)

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "undo-"))
  stateRoot = join(dir, "state")
  backupRoot = join(stateRoot, "backups")
})

function plan(parts: Partial<WritePlan>): WritePlan {
  return { edits: [], moves: [], copies: [], removals: [], commands: [], notices: [], ...parts }
}

const read = (path: string) => readFile(path, "utf8")
const succeed: CommandRunner = async () => ({ code: 0, stderr: "" })

test("undo restores an edited file to its before-text", async () => {
  const file = join(dir, "notes.md")
  await writeFile(file, "before")
  await applyWithUndo(plan({ edits: [{ path: file, before: "before", after: "after" }] }), { backupRoot, now })
  expect(await undoLast(stateRoot)).toBe("Undone.")
  expect(await read(file)).toBe("before")
})

test("undo deletes a file the change created", async () => {
  const file = join(dir, "new.md")
  await applyWithUndo(plan({ edits: [{ path: file, before: null, after: "content" }] }), { backupRoot, now })
  expect(existsSync(file)).toBe(true)
  await undoLast(stateRoot)
  expect(existsSync(file)).toBe(false)
})

test("undo reverses a move", async () => {
  const from = join(dir, "skills/pdf")
  const to = join(dir, "other/skills/pdf")
  await mkdir(from, { recursive: true })
  await writeFile(join(from, "SKILL.md"), "pdf skill")
  await applyWithUndo(plan({ moves: [{ from, to }] }), { backupRoot, now })
  await undoLast(stateRoot)
  expect(await read(join(from, "SKILL.md"))).toBe("pdf skill")
  expect(existsSync(to)).toBe(false)
})

test("undo deletes a copy and keeps its source", async () => {
  const from = join(dir, "skills/pdf")
  const to = join(dir, "other/skills/pdf")
  await mkdir(from, { recursive: true })
  await writeFile(join(from, "SKILL.md"), "pdf skill")
  await applyWithUndo(plan({ copies: [{ from, to }] }), { backupRoot, now })
  await undoLast(stateRoot)
  expect(existsSync(to)).toBe(false)
  expect(await read(join(from, "SKILL.md"))).toBe("pdf skill")
})

test("undo restores a removal from its backup", async () => {
  const skill = join(dir, "skills/pdf")
  await mkdir(skill, { recursive: true })
  await writeFile(join(skill, "SKILL.md"), "pdf skill")
  await applyWithUndo(plan({ removals: [skill] }), { backupRoot, now })
  expect(existsSync(skill)).toBe(false)
  await undoLast(stateRoot)
  expect(await read(join(skill, "SKILL.md"))).toBe("pdf skill")
})

test("undo refuses when a file changed and leaves every file untouched", async () => {
  const file = join(dir, "notes.md")
  await writeFile(file, "before")
  await applyWithUndo(plan({ edits: [{ path: file, before: "before", after: "after" }] }), { backupRoot, now })
  await writeFile(file, "changed later")
  const attempt = undoLast(stateRoot)
  await expect(attempt).rejects.toBeInstanceOf(UndoConflictError)
  await expect(attempt).rejects.toThrow(file)
  expect(await read(file)).toBe("changed later")
  await writeFile(file, "after")
  expect(await undoLast(stateRoot)).toBe("Undone.")
  expect(await read(file)).toBe("before")
})

test("undo of a change with a command says the command is not undone", async () => {
  const file = join(dir, "notes.md")
  await writeFile(file, "before")
  await applyWithUndo(
    plan({ edits: [{ path: file, before: "before", after: "after" }], commands: [{ argv: ["claude", "mcp", "add"], touches: [] }] }),
    { backupRoot, now, run: succeed },
  )
  expect(await undoLast(stateRoot)).toBe("Undone. Commands that ran are not undone.")
  expect(await read(file)).toBe("before")
})

test("a commands-only change has nothing to undo and is not reversed", async () => {
  await applyWithUndo(plan({ commands: [{ argv: ["claude", "plugin", "install"], touches: [] }] }), { backupRoot, now, run: succeed })
  expect(await undoLast(stateRoot)).toBe("Nothing to undo; this change ran a command.")
  expect(await undoLast(stateRoot)).toBe("Nothing to undo.")
})

test("undo refuses to overwrite a file the user recreated after a removal", async () => {
  const file = join(dir, "CLAUDE.md")
  await writeFile(file, "original\n")
  await applyWithUndo(plan({ removals: [file] }), { backupRoot, now })
  await writeFile(file, "written by hand\n")
  await expect(undoLast(stateRoot)).rejects.toBeInstanceOf(UndoConflictError)
  expect(await read(file)).toBe("written by hand\n")
})

test("undo refuses to overwrite a source folder the user recreated after a move", async () => {
  const from = join(dir, "skills", "deploy.md")
  const to = join(dir, "other", "deploy.md")
  await mkdir(join(dir, "skills"), { recursive: true })
  await writeFile(from, "moved\n")
  await applyWithUndo(plan({ moves: [{ from, to }] }), { backupRoot, now })
  await writeFile(from, "recreated\n")
  await expect(undoLast(stateRoot)).rejects.toBeInstanceOf(UndoConflictError)
  expect(await read(from)).toBe("recreated\n")
  expect(await read(to)).toBe("moved\n")
})
