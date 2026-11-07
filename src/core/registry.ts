import { HARNESS_LABELS, type HarnessAdapter, type HarnessId, type Item, type Kind, type Roots } from "./model"

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

function union<T>(left: T[], right: T[]): T[] {
  return [...new Set([...left, ...right])]
}

// Values made only of env references (${VAR}) are safe to show; anything else may be a literal secret.
export function maskSecret(value: string): string {
  return value.includes("${") ? value : "••••••••"
}
