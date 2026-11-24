import { existsSync } from "node:fs"
import { useEffect, useState } from "react"
import { autoMemoryDir } from "../adapters/claude-code"
import type { Item, Roots } from "../core/model"
import { loadEntries } from "../memory/entry"
import type { AutoEntry } from "../memory/types"

// The AUTO MEMORY group: the current project's auto memory entries, in loadEntries order (indexed first).
export interface EntriesView {
  entries: AutoEntry[]
  dir: string // "" when Claude Code keeps no auto memory for this project
}

const EMPTY: EntriesView = { entries: [], dir: "" }

// The entries load from disk; a project with no auto memory folder gets an empty group.
export function useEntries(roots: Roots, reloads: number): EntriesView {
  const [loaded, setLoaded] = useState<{ roots: Roots; view: EntriesView }>({ roots, view: EMPTY })
  useEffect(() => {
    let live = true
    autoMemoryDir(roots)
      .then((dir) => (existsSync(dir) ? { entries: loadEntries(dir), dir } : EMPTY))
      .then((view) => live && setLoaded({ roots, view }))
    return () => {
      live = false
    }
  }, [roots, reloads])
  // The previous project's entries are never drawn under a new project.
  return loaded.roots === roots ? loaded.view : EMPTY
}

// An entry wrapped as an Item, so the existing edit and delete flows plan its change.
export function entryItem(entry: AutoEntry): Item {
  return { kind: "memory", harness: "claude-code", scope: "project", name: entry.file, path: entry.path, loadedBy: ["claude-code"] }
}
