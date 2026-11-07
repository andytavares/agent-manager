import { useKeyboard } from "@opentui/react"
import { useRef, useState } from "react"
import { basename } from "node:path"
import type { ProjectData } from "../core/model"
import { ACCENT, DIM, tildePath } from "./ItemList"

interface ProjectsProps {
  projects: ProjectData[]
  current: string
  home: string
  onOpen: (project: ProjectData) => void
  onDelete: (projects: ProjectData[]) => void // the marked projects, else the highlighted one
  onBack: () => void
}

export function Projects({ projects, current, home, onOpen, onDelete, onBack }: ProjectsProps) {
  const start = Math.max(0, projects.findIndex((project) => project.path === current))
  // Refs, because a key can arrive before the previous key's render.
  const selected = useRef(start)
  const markedNow = useRef(new Set<string>())
  const [marked, setMarked] = useState(markedNow.current)
  const toggleMark = (dataDir: string) => {
    const next = new Set(markedNow.current)
    if (!next.delete(dataDir)) next.add(dataDir)
    markedNow.current = next
    setMarked(next)
  }
  useKeyboard((key) => {
    const project = projects[selected.current]
    if (key.name === "escape") onBack()
    if (key.name === "space" && project) toggleMark(project.dataDir)
    const chosen = markedNow.current.size ? projects.filter((entry) => markedNow.current.has(entry.dataDir)) : [project].filter((entry) => entry !== undefined)
    if (key.name === "d" && chosen.length) onDelete(chosen)
  })
  const options = projects.map((project) => ({
    name: `${marked.has(project.dataDir) ? "●" : " "} ${project.path ? tildePath(project.path, home) : basename(project.dataDir)}`,
    description: `  ${tildePath(project.dataDir, home)}${project.path === current ? " · current" : ""}`,
    value: project.dataDir,
  }))
  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1}>
      <text>
        <span fg={ACCENT}>Projects</span>
        {marked.size ? `  ${marked.size} marked` : ""}
      </text>
      {options.length ? (
        <select options={options} selectedIndex={start} focused flexGrow={1} onChange={(index) => (selected.current = index)} onSelect={(index) => onOpen(projects[index]!)} />
      ) : (
        <text fg={DIM}>No projects</text>
      )}
    </box>
  )
}
