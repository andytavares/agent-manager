import { useEffect, useState } from "react"
import type { Item, Kind, Roots } from "../core/model"
import { mcpUsage, readUses, sinceNote, skillUsage, transcriptsSince, type Usage } from "../memory/usage"

// Usage per item, keyed by the item; only Claude Code items have an entry. note names the transcript range.
export interface UsageView {
  byItem: Map<Item, Usage>
  note: string
}

const EMPTY: UsageView = { byItem: new Map(), note: "" }

// Claude Code keeps transcripts under its config dir, one folder per project, named like /a/b -> -a-b.
function scanRoots(roots: Roots): { config: string; folders: string[] } {
  return {
    config: roots.env.CLAUDE_CONFIG_DIR ?? `${roots.home}/.claude`,
    folders: [roots.project.replace(/[/.]/g, "-")],
  }
}

// The transcript scan is synchronous, so it runs once per listing rather than on every render.
export function useUsage(items: Item[], kind: Kind | "health", roots: Roots): UsageView {
  const [loaded, setLoaded] = useState<{ items: Item[]; view: UsageView }>({ items: [], view: EMPTY })
  useEffect(() => {
    if (kind !== "mcp" && kind !== "skill") return
    const { config, folders } = scanRoots(roots)
    try {
      const uses = readUses(config)
      const byItem = new Map(
        items
          .filter((item) => item.loadedBy.includes("claude-code"))
          .map((item) => [item, kind === "mcp" ? mcpUsage(item.name, uses, folders) : skillUsage(item.name, uses, folders)]),
      )
      setLoaded({ items, view: { byItem, note: sinceNote(transcriptsSince(config)) } })
    } catch (error) {
      setLoaded({ items, view: { byItem: new Map(), note: `Cannot count usage: ${(error as Error).message}` } })
    }
  }, [items, kind, roots])
  // The previous listing's counts are never drawn under a new list.
  return loaded.items === items ? loaded.view : EMPTY
}
