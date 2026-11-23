export type Level = "managed" | "global" | "project"
export type Kind = "claude-md" | "claude-local-md" | "agents-md" | "rule" | "auto-index" | "auto-entry"
export type MemoryType = "user" | "feedback" | "project" | "reference"

export interface Source {
  level: Level
  kind: Kind
  path: string
  readOnly: boolean
  loadsAtStart: boolean
  lines: number
  bytes: number
  mtimeMs: number
}

export interface AutoEntry extends Source {
  file: string
  name: string
  title: string
  hook: string
  description: string
  type: MemoryType | null
  body: string
  frontmatterRaw: string
  frontmatterValid: boolean
  indexLine: number | null
  pastLoadLimit: boolean
  links: string[]
  modified: string | null
}

export interface IndexRow { line: number; title: string; file: string; hook: string }

export interface HealthIssue {
  kind: "orphan" | "dead-index" | "broken-link" | "past-limit" | "over-budget" | "bad-frontmatter"
  path: string
  detail: string
}
