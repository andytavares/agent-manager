import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { parse } from "yaml"
import { HARNESS_LABELS, type Change, type FileEdit, type HarnessId, type WritePlan } from "./model"

export interface SkillFolder {
  name: string // folder name; the skill's id in every harness
  path: string
}

// Skills live one level deep: <root>/<name>/SKILL.md. Symlinked folders count.
export async function listSkillFolders(root: string): Promise<SkillFolder[]> {
  if (!existsSync(root)) return []
  const entries = await readdir(root)
  return entries
    .filter((name) => existsSync(join(root, name, "SKILL.md")))
    .sort()
    .map((name) => ({ name, path: join(root, name) }))
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export function parseFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const match = FRONTMATTER.exec(text)
  if (!match) return { data: {}, body: text }
  return { data: (parse(match[1]!) ?? {}) as Record<string, unknown>, body: text.slice(match[0].length) }
}

export function skillChecks(harness: HarnessId, folderName: string, text: string): string[] {
  const label = HARNESS_LABELS[harness]
  let data: Record<string, unknown>
  try {
    data = parseFrontmatter(text).data
  } catch (error) {
    return [`${label}: frontmatter does not parse: ${(error as Error).message}`]
  }
  const problems =
    harness === "codex" ? codexProblems(data) : harness === "opencode" ? openCodeProblems(data, folderName) : []
  return problems.map((problem) => `${label}: ${problem}`)
}

const isText = (value: unknown): value is string => typeof value === "string" && value !== ""

function codexProblems(data: Record<string, unknown>): string[] {
  const problems: string[] = []
  if (!isText(data.name)) problems.push("name is required")
  if (!isText(data.description)) problems.push("description is required")
  return problems
}

const OPENCODE_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/

function openCodeProblems(data: Record<string, unknown>, folderName: string): string[] {
  const problems: string[] = []
  if (!isText(data.description)) problems.push("description is required")
  else if (data.description.length > 1024) problems.push("description must be at most 1024 characters")
  if (data.name === undefined) return problems
  const name = String(data.name)
  if (!OPENCODE_NAME.test(name)) problems.push("name must use lowercase letters, digits and single hyphens")
  if (name.length > 64) problems.push("name must be at most 64 characters")
  if (name !== folderName) problems.push("name must match the folder name")
  return problems
}

// readers = harnesses that read the target skill root; the caller computes them.
export async function planSkill(change: Change, readers: HarnessId[]): Promise<WritePlan> {
  const plan: WritePlan = { edits: [], moves: [], copies: [], removals: [], commands: [], notices: [] }
  if (change.op === "create") {
    plan.edits.push(createEdit(change, readers))
    return plan
  }
  const folder = change.item!.path
  if (change.item!.readOnly) throw new Error(`${change.item!.name} is read-only: ${change.item!.readOnly}.`)
  if (change.op === "update") {
    const path = join(folder, "SKILL.md")
    plan.edits.push({ path, before: await readFile(path, "utf8"), after: change.text! })
  } else if (change.op === "delete") {
    plan.removals.push(folder)
  } else {
    const to = join(change.destination!, basename(folder))
    if (existsSync(to)) throw new Error(`${to} already exists.`)
    plan[change.op === "move" ? "moves" : "copies"].push({ from: folder, to })
  }
  return plan
}

function createEdit(change: Change, readers: HarnessId[]): FileEdit {
  const name = change.name ?? ""
  if (name === "" || name === "." || name === ".." || /[/\\]/.test(name)) {
    throw new Error(`"${name}" is not a valid skill folder name.`)
  }
  const folder = join(change.destination!, name)
  if (existsSync(folder)) throw new Error(`${folder} already exists.`)
  const text = change.text ?? `---\nname: ${name}\ndescription:\n---\n\n`
  const problems = readers.map((harness) => skillChecks(harness, name, text))
  if (readers.length > 0 && problems.every((list) => list.length > 0)) throw new Error(problems.flat().join("\n"))
  return { path: join(folder, "SKILL.md"), before: null, after: text }
}
