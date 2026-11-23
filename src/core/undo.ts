import { appendFile, mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { applyPlan, type ApplyOptions, movePath, readText } from "./apply"
import type { FileEdit, WritePlan } from "./model"

// Records the undo after applyPlan succeeds, so a failed plan leaves no record.
export async function applyWithUndo(plan: WritePlan, options: ApplyOptions): Promise<{ backupDir: string; notices: string[] }> {
  const result = await applyPlan(plan, options)
  await recordUndo(plan, { stateRoot: dirname(options.backupRoot), backupDir: result.backupDir }, options.now ?? new Date())
  return result
}

export class UndoConflictError extends Error {
  constructor(readonly path: string) {
    super(`${path} changed after that change. Undo would discard the change, so nothing was undone.`)
  }
}

interface UndoRecord {
  timestamp: string
  edits: FileEdit[]
  moves: { from: string; to: string }[]
  copies: { from: string; to: string }[]
  removals: { path: string; backup: string }[]
  hasCommands: boolean
}

// The log sits next to the backups, so a state folder holds both and one deletion clears both.
export function undoLogPath(stateRoot: string): string {
  return join(stateRoot, "undo.jsonl")
}

// Records only the reversible parts: previewOnly edits are written by a command, so undo cannot reverse them.
export async function recordUndo(plan: WritePlan, where: { stateRoot: string; backupDir: string }, now: Date): Promise<void> {
  const record: UndoRecord = {
    timestamp: now.toISOString(),
    edits: plan.edits.filter((edit) => !edit.previewOnly),
    moves: plan.moves,
    copies: plan.copies,
    removals: plan.removals.map((path) => ({ path, backup: join(where.backupDir, path) })),
    hasCommands: plan.commands.length > 0,
  }
  await mkdir(where.stateRoot, { recursive: true })
  await appendFile(undoLogPath(where.stateRoot), `${JSON.stringify(record)}\n`)
}

export async function undoLast(stateRoot: string): Promise<string> {
  const record = await popUndo(stateRoot)
  if (!record) return "Nothing to undo."
  if (!hasParts(record)) return "Nothing to undo; this change ran a command."
  const changed = await findChanged(record)
  if (changed) {
    await pushUndo(stateRoot, record)
    throw new UndoConflictError(changed)
  }
  await reverse(record)
  return record.hasCommands ? "Undone. Commands that ran are not undone." : "Undone."
}

function hasParts(record: UndoRecord): boolean {
  const { edits, moves, copies, removals } = record
  return edits.length + moves.length + copies.length + removals.length > 0
}

// The same check the apply makes: a file changed since the record's after-text must stop the undo.
async function findChanged(record: UndoRecord): Promise<string | null> {
  for (const edit of record.edits) if ((await readText(edit.path)) !== edit.after) return edit.path
  return null
}

// Reverse order, so a removal is restored last and a move's source exists again before it is used.
async function reverse(record: UndoRecord): Promise<void> {
  for (const edit of [...record.edits].reverse()) await restoreEdit(edit)
  for (const { from, to } of [...record.moves].reverse()) await movePath(to, from)
  for (const { to } of [...record.copies].reverse()) await rm(to, { recursive: true, force: true })
  for (const removal of [...record.removals].reverse()) await movePath(removal.backup, removal.path)
}

async function restoreEdit(edit: FileEdit): Promise<void> {
  if (edit.before === null) {
    await rm(edit.path, { force: true })
    return
  }
  await mkdir(dirname(edit.path), { recursive: true })
  await writeFile(edit.path, edit.before)
}

async function pushUndo(stateRoot: string, record: UndoRecord): Promise<void> {
  const logPath = undoLogPath(stateRoot)
  await mkdir(stateRoot, { recursive: true })
  await appendFile(logPath, `${JSON.stringify(record)}\n`)
}

// A refused undo goes back on the log, so the user can retry after resolving the change.
async function popUndo(stateRoot: string): Promise<UndoRecord | null> {
  const logPath = undoLogPath(stateRoot)
  const lines = (await readText(logPath))?.split("\n").filter(Boolean) ?? []
  const last = lines.pop()
  if (last === undefined) return null
  await writeFile(logPath, lines.map((line) => `${line}\n`).join(""))
  return JSON.parse(last) as UndoRecord
}
