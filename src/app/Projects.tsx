import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useRef, useState } from "react"
import { basename } from "node:path"
import type { ProjectData } from "../core/model"
import { pad, shortPath } from "../memory/format"
import { Dialog } from "./Dialog"
import { tildePath } from "./ItemList"
import { OptionRow, useCursor } from "./Prompt"
import { DIM, theme } from "./theme"

interface ProjectsProps {
  projects: ProjectData[]
  current: string
  home: string
  onOpen: (project: ProjectData) => void
  onDelete: (projects: ProjectData[]) => void // the marked projects, else the highlighted one
  onBack: () => void
}

const TABLE_WIDTH = 96
const PROJECT_WIDTH = 30
const DATA_WIDTH = 44
const DELETE_NOTE = "d deletes the Claude Code data of the marked projects (transcripts, auto memory). You review it first."

export function Projects({ projects, current, home, onOpen, onDelete, onBack }: ProjectsProps) {
  const cursor = useCursor(projects.length, Math.max(0, projects.findIndex((project) => project.path === current)))
  const { width } = useTerminalDimensions()
  // A ref, because a key can arrive before the previous key's render.
  const markedNow = useRef(new Set<string>())
  const [marked, setMarked] = useState(markedNow.current)
  const toggleMark = (dataDir: string) => {
    const next = new Set(markedNow.current)
    if (!next.delete(dataDir)) next.add(dataDir)
    markedNow.current = next
    setMarked(next)
  }
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
  return (
    <Dialog title="Projects" right={`${projects.length} projects · ${marked.size} marked`} width={Math.min(TABLE_WIDTH, width - 4)}>
      <text> </text>
      {projects.length ? <text fg={DIM}>{`    ${pad("PROJECT", PROJECT_WIDTH)}CLAUDE CODE DATA`}</text> : <text fg={DIM}>No projects</text>}
      {projects.map((project, index) => (
        <OptionRow key={project.dataDir} selected={index === cursor.index}>
          {projectCells(project, home, marked.has(project.dataDir))}
          <Badge project={project} current={current} />
        </OptionRow>
      ))}
      <text> </text>
      <text fg={DIM}>{DELETE_NOTE}</text>
    </Dialog>
  )
}

function projectCells(project: ProjectData, home: string, marked: boolean): string {
  const name = project.path ? tildePath(project.path, home) : basename(project.dataDir)
  return ` ${marked ? "●" : " "} ${pad(name, PROJECT_WIDTH)}${pad(shortPath(tildePath(project.dataDir, home), DATA_WIDTH - 2), DATA_WIDTH)}`
}

function Badge({ project, current }: { project: ProjectData; current: string }) {
  if (project.path === current) return <span fg={theme.group}>● current</span>
  return project.path ? null : <span fg={theme.warn}>folder unknown</span>
}
