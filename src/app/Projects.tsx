import type { BoxRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useRef, useState } from "react"
import { basename, dirname, relative } from "node:path"
import type { ProjectData } from "../core/model"
import { CellHeader, Cells, columnWidths, SelectableRow, tableDialogWidth, type Cell, type Column } from "./CellRow"
import { Dialog } from "./Dialog"
import { tildePath } from "./ItemList"
import { useCursor } from "./Prompt"
import { ScrollList, type ScrollRow } from "./ScrollList"
import { DIM, theme } from "./theme"

interface ProjectsProps {
  projects: ProjectData[]
  current: string
  home: string
  onOpen: (project: ProjectData) => void
  onDelete: (projects: ProjectData[]) => void // the marked projects, else the highlighted one
  onBack: () => void
}

const DELETE_NOTE = "d deletes the Claude Code data of the marked projects (transcripts, auto memory). You review it first."
// The rows of the project list leave room for the app header, the dialog lines around them and the key bar.
const CHROME_HEIGHT = 16
const SCROLLBAR_WIDTH = 1
const DIALOG_FRAME = 4 // border and padding on both sides

export function Projects({ projects, current, home, onOpen, onDelete, onBack }: ProjectsProps) {
  const cursor = useCursor(projects.length, Math.max(0, projects.findIndex((project) => project.path === current)))
  const { width, height } = useTerminalDimensions()
  const { marked, markedNow, toggleMark } = useMarks()
  const actOnHighlighted = (name: string) => {
    const project = projects[cursor.now.current]
    if (!project) return
    if (name === "return") onOpen(project)
    if (name === "space") toggleMark(project.dataDir)
    if (name === "d") onDelete(markedNow.current.size ? projects.filter((entry) => markedNow.current.has(entry.dataDir)) : [project])
  }
  useKeyboard((key) => {
    if (key.name === "escape") onBack()
    else if (key.name === "up" || key.name === "down") cursor.move(key.name === "up" ? -1 : 1)
    else actOnHighlighted(key.name)
  })
  const highlighted = projects[cursor.index]
  const rowHeights = useRowHeights(projects)
  const table = projectTable({ projects, current, home, marked })
  return (
    <Dialog title="Projects" right={`${projects.length} projects · ${marked.size} marked`} width={Math.min(width - 4, Math.max(tableDialogWidth(table.widths) + SCROLLBAR_WIDTH, table.place.length + DIALOG_FRAME))}>
      {projects.length ? <text fg={DIM}>{table.place}</text> : <text> </text>}
      {projects.length ? <CellHeader columns={table.columns} widths={table.widths} /> : <text fg={DIM}>No projects</text>}
      <box flexDirection="column" height={Math.min(rowHeights.total, Math.max(3, height - CHROME_HEIGHT))}>
        <ScrollList rows={table.rows(cursor.index, rowHeights.measure)} selectedId={highlighted?.dataDir} />
      </box>
      {highlighted && <text><span fg={DIM}>data  </span>{highlighted.dataDir}</text>}
      <text> </text>
      <text fg={DIM}>{DELETE_NOTE}</text>
    </Dialog>
  )
}

function useMarks() {
  // A ref, because a key can arrive before the previous key's render.
  const markedNow = useRef(new Set<string>())
  const [marked, setMarked] = useState(markedNow.current)
  const toggleMark = (dataDir: string) => {
    const next = new Set(markedNow.current)
    if (!next.delete(dataDir)) next.add(dataDir)
    markedNow.current = next
    setMarked(next)
  }
  return { marked, markedNow, toggleMark }
}

interface ProjectTableSource {
  projects: ProjectData[]
  current: string
  home: string
  marked: Set<string>
}

// Every data folder sits in one parent folder, so the line above the table names it once and each row shows the folder name.
function projectTable({ projects, current, home, marked }: ProjectTableSource) {
  const parent = projects[0] ? dirname(projects[0].dataDir) : ""
  const columns: Column[] = [
    { header: "", give: "fixed" },
    { header: "PROJECT", give: "name" },
    { header: "CLAUDE CODE DATA", give: "path" },
    { header: "", give: "fixed" },
  ]
  const cells = projects.map((project): Cell[] => [
    [marked.has(project.dataDir) ? "●" : " "],
    [project.path ? tildePath(project.path, home) : basename(project.dataDir)],
    [relative(parent, project.dataDir)],
    badge(project, current),
  ])
  const widths = columnWidths(columns, cells)
  const rows = (selected: number, measure: (id: string) => () => void): ScrollRow[] =>
    projects.map((project, index) => ({
      id: project.dataDir,
      node: (
        <box onSizeChange={measure(project.dataDir)}>
          <SelectableRow selected={index === selected}>
            <Cells cells={cells[index]!} columns={columns} widths={widths} />
          </SelectableRow>
        </box>
      ),
    }))
  return { columns, widths, rows, place: `Claude Code data folders are in ${tildePath(parent, home)}/` }
}

function badge(project: ProjectData, current: string): Cell {
  if (project.path === current) return ["● current", theme.group]
  return project.path ? [""] : ["folder unknown", theme.warn]
}

// A scroll box takes all the height it is given, so the list gets the height its wrapped rows measure.
function useRowHeights(projects: ProjectData[]) {
  const [heights, setHeights] = useState<Record<string, number>>({})
  const measure = (id: string) =>
    function (this: BoxRenderable) {
      const height = this.height
      setHeights((known) => (known[id] === height ? known : { ...known, [id]: height }))
    }
  const total = projects.reduce((sum, project) => sum + (heights[project.dataDir] ?? 1), 0)
  return { measure, total }
}
