import { existsSync } from "node:fs"
import { cp, mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { Roots, WritePlan } from "./model"

export type CommandRunner = (argv: string[], cwd?: string) => Promise<{ code: number; stderr: string }>

export interface ApplyOptions {
  backupRoot: string
  now?: Date
  run?: CommandRunner
}

export class StaleFileError extends Error {
  constructor(readonly path: string) {
    super(`${path} changed since it was read; reload and try again.`)
  }
}

export class CommandError extends Error {
  constructor(
    readonly argv: string[],
    readonly code: number,
    readonly stderr: string,
  ) {
    super(`${argv.join(" ")} exited with code ${code}: ${stderr}`)
  }
}

export function defaultBackupRoot(roots: Roots): string {
  const stateHome = roots.env.XDG_STATE_HOME ?? join(roots.home, ".local/state")
  return join(stateHome, "agent-manager/backups")
}

// Order: check everything, back up, then edits, moves, copies, commands. A failed command leaves earlier steps applied.
export async function applyPlan(plan: WritePlan, options: ApplyOptions): Promise<{ backupDir: string; notices: string[] }> {
  await checkPlan(plan)
  const backupDir = join(options.backupRoot, timestamp(options.now ?? new Date()))
  await backUp(plan, backupDir)
  await writeEdits(plan)
  for (const move of plan.moves) await movePath(move.from, move.to)
  for (const { from, to } of plan.copies) {
    await mkdir(dirname(to), { recursive: true })
    await cp(from, to, { recursive: true })
  }
  const run = options.run ?? runCommand
  for (const { argv, cwd } of plan.commands) {
    const { code, stderr } = await run(argv, cwd)
    if (code !== 0) throw new CommandError(argv, code, stderr)
  }
  return { backupDir, notices: plan.notices }
}

async function checkPlan(plan: WritePlan): Promise<void> {
  for (const edit of plan.edits) {
    if (edit.previewOnly) continue
    if ((await readText(edit.path)) !== edit.before) throw new StaleFileError(edit.path)
  }
  for (const { from, to } of plan.moves) {
    if (!existsSync(from)) throw new Error(`Cannot move ${from}: it does not exist.`)
    if (existsSync(to)) throw new Error(`Cannot move to ${to}: it already exists.`)
  }
  for (const { from, to } of plan.copies) {
    if (!existsSync(from)) throw new Error(`Cannot copy ${from}: it does not exist.`)
    if (existsSync(to)) throw new Error(`Cannot copy to ${to}: it already exists.`)
  }
}

async function backUp(plan: WritePlan, backupDir: string): Promise<void> {
  const copies = [
    ...plan.edits.filter((edit) => !edit.previewOnly).map((edit) => edit.path),
    ...plan.commands.flatMap((command) => command.touches),
    ...plan.moves.map((move) => move.from),
  ]
  await mkdir(backupDir, { recursive: true })
  for (const path of copies) {
    if (existsSync(path)) await cp(path, join(backupDir, path), { recursive: true })
  }
  for (const path of plan.removals) await movePath(path, join(backupDir, path))
}

async function writeEdits(plan: WritePlan): Promise<void> {
  for (const edit of plan.edits) {
    if (edit.previewOnly) continue
    if (edit.after === null) {
      await unlink(edit.path)
      continue
    }
    const temporary = `${edit.path}.agent-manager.tmp`
    await mkdir(dirname(edit.path), { recursive: true })
    await writeFile(temporary, edit.after)
    await rename(temporary, edit.path)
  }
}

export async function movePath(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true })
  try {
    await rename(from, to)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error
    await cp(from, to, { recursive: true })
    await rm(from, { recursive: true })
  }
}

export async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

function timestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `${day}T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

async function runCommand(argv: string[], cwd?: string): Promise<{ code: number; stderr: string }> {
  const child = Bun.spawn(argv, { cwd, stdout: "ignore", stderr: "pipe" })
  const stderr = await new Response(child.stderr).text()
  return { code: await child.exited, stderr }
}
