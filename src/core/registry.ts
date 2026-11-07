import { dirname } from "node:path"
import {
  HARNESS_LABELS,
  type Change,
  type HarnessAdapter,
  type HarnessId,
  type Item,
  type Kind,
  type McpServer,
  type Roots,
  type Scope,
  type WritePlan,
} from "./model"
import { planSkill } from "./skills"

const HARNESS_ORDER = Object.keys(HARNESS_LABELS) as HarnessId[]

export async function listItems(adapters: HarnessAdapter[], kind: Kind, roots: Roots): Promise<Item[]> {
  const detected = (await Promise.all(adapters.map((adapter) => adapter.detect(roots))))
  const active = adapters.filter((_, index) => detected[index])
  const lists = await Promise.all(active.map((adapter) => adapter.list(kind, roots)))
  const merged = new Map<string, Item>()
  for (const copy of lists.flat()) {
    const id = `${copy.kind}\0${copy.path}\0${copy.key ?? ""}`
    const first = merged.get(id)
    merged.set(id, first ? mergeCopies(first, copy) : { ...copy, loadedBy: [...copy.loadedBy] })
  }
  const items = [...merged.values()]
  if (kind === "mcp") await addImporters(active, items, roots)
  return items.sort(
    (a, b) => a.name.localeCompare(b.name) || HARNESS_ORDER.indexOf(a.harness) - HARNESS_ORDER.indexOf(b.harness),
  )
}

function mergeCopies(first: Item, copy: Item): Item {
  const loadedBy = union(first.loadedBy, copy.loadedBy)
  return {
    ...first,
    loadedBy,
    offIn: union(first.offIn ?? [], copy.offIn ?? []).filter((id) => !loadedBy.includes(id)),
    warnings: union(first.warnings ?? [], copy.warnings ?? []),
    readOnly: copy.readOnly && first.readOnly,
  }
}

async function addImporters(adapters: HarnessAdapter[], items: Item[], roots: Roots): Promise<void> {
  for (const adapter of adapters) {
    if (!adapter.importsMcpFrom) continue
    const sources = await adapter.importsMcpFrom(roots)
    for (const item of items) {
      if (!sources.some((source) => source.harness === item.harness && source.scope === item.scope)) continue
      item.loadedBy = union(item.loadedBy, [adapter.id])
      item.offIn = item.offIn?.filter((id) => id !== adapter.id)
    }
  }
}

export async function planChange(adapters: HarnessAdapter[], change: Change, roots: Roots): Promise<WritePlan> {
  if (change.kind === "skill") {
    const root = change.destination ?? dirname(change.item!.path)
    const choice = (await skillRootChoices(adapters, roots)).find((candidate) => candidate.path === root)
    return planSkill(change, choice?.readers ?? [])
  }
  const adapter = adapters.find((candidate) => candidate.id === change.target.harness)
  if (!adapter) throw new Error(`${HARNESS_LABELS[change.target.harness]} is not available.`)
  return adapter.plan(change, roots)
}

// Every skill root (of one scope, when given) with the harnesses that read it, in adapter order.
export async function skillRootChoices(
  adapters: HarnessAdapter[],
  roots: Roots,
  scope?: Scope,
): Promise<{ path: string; readers: HarnessId[] }[]> {
  const readersByRoot = new Map<string, HarnessId[]>()
  for (const adapter of adapters) {
    for (const root of await adapter.skillRoots(roots)) {
      if (scope && root.scope !== scope) continue
      readersByRoot.set(root.path, union(readersByRoot.get(root.path) ?? [], [adapter.id]))
    }
  }
  return [...readersByRoot].map(([path, readers]) => ({ path, readers }))
}

function union<T>(left: T[], right: T[]): T[] {
  return [...new Set([...left, ...right])]
}

// Values made only of env references (${VAR}) are safe to show; anything else may be a literal secret.
export function maskSecret(value: string): string {
  return value.includes("${") ? value : "••••••••"
}

// Env and header values of a server that maskSecret would hide.
export function literalSecrets(server: McpServer | undefined): string[] {
  const values = [...Object.values(server?.env ?? {}), ...Object.values(server?.headers ?? {})]
  return values.filter((value) => value && maskSecret(value) !== value)
}

// One plan for one review, from one plan per target.
export function mergePlans(plans: WritePlan[]): WritePlan {
  return {
    edits: plans.flatMap((plan) => plan.edits),
    moves: plans.flatMap((plan) => plan.moves),
    copies: plans.flatMap((plan) => plan.copies),
    removals: plans.flatMap((plan) => plan.removals),
    commands: plans.flatMap((plan) => plan.commands),
    notices: union([], plans.flatMap((plan) => plan.notices)),
  }
}
