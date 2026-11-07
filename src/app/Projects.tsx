import { useKeyboard } from "@opentui/react"
import { useRef } from "react"
import { basename } from "node:path"
import type { ProjectData } from "../core/model"
import { ACCENT, DIM, tildePath } from "./ItemList"

interface ProjectsProps {
  projects: ProjectData[]
  current: string
  home: string
  onOpen: (project: ProjectData) => void
  onDelete: (project: ProjectData) => void
  onBack: () => void
}

export function Projects({ projects, current, home, onOpen, onDelete, onBack }: ProjectsProps) {
  const start = Math.max(0, projects.findIndex((project) => project.path === current))
  const selected = useRef(start) // a ref, because d can arrive before the arrow key's render
  useKeyboard((key) => {
    if (key.name === "escape") onBack()
    const project = projects[selected.current]
    if (key.name === "d" && project) onDelete(project)
  })
  const options = projects.map((project) => ({
    name: project.path ? tildePath(project.path, home) : basename(project.dataDir),
    description: `${tildePath(project.dataDir, home)}${project.path === current ? " · current" : ""}`,
    value: project.dataDir,
  }))
  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1}>
      <text fg={ACCENT}>Projects</text>
      {options.length ? (
        <select options={options} selectedIndex={start} focused flexGrow={1} onChange={(index) => (selected.current = index)} onSelect={(index) => onOpen(projects[index]!)} />
      ) : (
        <text fg={DIM}>No projects</text>
      )}
    </box>
  )
}
