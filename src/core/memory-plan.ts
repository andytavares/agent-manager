import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { Change, Scope, WritePlan } from "./model"

export const emptyPlan = (): WritePlan => ({ edits: [], moves: [], copies: [], removals: [], commands: [], notices: [] })

// A memoryFiles entry as a pattern; "<name>" accepts one safe file-name segment.
export function memoryPattern(pattern: string): RegExp {
  return new RegExp(`^${pattern.replaceAll(".", "\\.").replace("<name>", "[a-z0-9][a-z0-9-_]*")}$`)
}

export interface MemoryPlanOptions {
  label: string // harness label for messages
  scopeRoot: (scope: Scope) => string
  memoryFiles: Partial<Record<Scope, string[]>>
}

// Create, update or delete one plain memory file. Harness-specific cases are handled by the caller first.
export async function planMemoryFile(change: Change, options: MemoryPlanOptions): Promise<WritePlan> {
  const { label } = options
  if (change.op === "create") return planCreate(change, options)
  const item = change.item!
  if (item.readOnly) throw new Error(`${label}: ${item.name} is read-only (${item.readOnly})`)
  if (change.op === "delete") return { ...emptyPlan(), removals: [item.path] }
  if (change.op !== "update") throw new Error(`${label}: memory files cannot ${change.op}`)
  return { ...emptyPlan(), edits: [{ path: item.path, before: await readFile(item.path, "utf8"), after: change.text ?? "" }] }
}

function planCreate(change: Change, { label, scopeRoot, memoryFiles }: MemoryPlanOptions): WritePlan {
  const { scope } = change.target
  const name = change.name ?? ""
  if (!memoryFiles[scope]?.some((pattern) => memoryPattern(pattern).test(name))) throw new Error(`${label}: ${name} is not a ${scope} memory file`)
  const path = join(scopeRoot(scope), name)
  if (existsSync(path)) throw new Error(`${label}: ${path} already exists`)
  return { ...emptyPlan(), edits: [{ path, before: null, after: change.text ?? "" }] }
}
