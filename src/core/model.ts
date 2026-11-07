export type HarnessId = "claude-code" | "codex" | "opencode" | "omp"
export type Scope = "global" | "project" | "local" // local = Claude Code private project scope
export type Kind = "memory" | "mcp" | "skill" | "plugin"

export const HARNESS_LABELS: Record<HarnessId, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  omp: "omp",
}

// home and project are absolute paths; env holds the variables adapters may read
// (CLAUDE_CONFIG_DIR, CODEX_HOME, PI_CODING_AGENT_DIR, OMP_PROFILE), so tests stay hermetic.
export interface Roots {
  home: string
  project: string
  env: Record<string, string | undefined>
}

// Adapters list every item their harness loads, including files another harness owns.
// The registry merges copies by (kind, path, key): loadedBy and offIn are unioned,
// harness comes from the first adapter in registry order, readOnly stays only if every copy is read-only.
export interface Item {
  kind: Kind
  harness: HarnessId // the adapter that listed it
  scope: Scope
  name: string
  path: string // real path of the file or folder
  key?: string // entry inside the file, e.g. "mcpServers.linear"
  loadedBy: HarnessId[] // harnesses that load it
  offIn?: HarnessId[] // harnesses that can read it but have it turned off; never also in loadedBy
  readOnly?: string // reason, e.g. "imported from Codex"
  warnings?: string[]
}

export interface McpServer {
  name: string
  transport: "stdio" | "http" | "sse"
  enabled: boolean
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string> // env refs stored as ${VAR}
  native: Record<string, unknown> // harness-only keys, written back unchanged
}

export interface PluginInfo {
  name: string // e.g. "github@official" or an npm package name
  enabled: boolean
  version?: string
  source?: string // marketplace, npm, or local path
}

export type ItemDetail =
  | { type: "text"; text: string }
  | { type: "mcp"; server: McpServer }
  | { type: "plugin"; plugin: PluginInfo }

export interface HarnessAdapter {
  id: HarnessId
  label: string
  scopes: Scope[]
  detect(roots: Roots): Promise<boolean>
  list(kind: Kind, roots: Roots): Promise<Item[]>
  read(item: Item): Promise<ItemDetail>
  // Builds the write plan for a memory or MCP change (later: plugin). Skills are planned in src/core/skills.ts.
  // Throws an Error with a user-facing message when the change is not allowed.
  plan(change: Change, roots: Roots): Promise<WritePlan>
  // Memory file names a user can create per scope, relative to that scope's root; "<name>" is filled in by the user.
  memoryFiles: Partial<Record<Scope, string[]>>
  // Skill roots this harness reads, in its own precedence order.
  skillRoots(roots: Roots): Promise<{ path: string; scope: Scope }[]>
  // MCP sources of other harnesses this harness imports (omp); the registry adds it to their loadedBy.
  importsMcpFrom?(roots: Roots): Promise<{ harness: HarnessId; scope: Scope }[]>
}

export interface Change {
  kind: Kind
  op: "create" | "update" | "delete" | "move" | "copy"
  target: { harness: HarnessId; scope: Scope }
  item?: Item // update, delete, move, copy
  name?: string // create: memory file name (from memoryFiles, "<name>" filled) or skill folder name
  text?: string // full new text: memory file or SKILL.md
  destination?: string // move, copy: destination skill root
  server?: McpServer // mcp create, update; on delete only for masking secrets in review
  plugin?: PluginInfo // plugin changes
}

// A change as files and commands. Adapters build it; only src/core/apply.ts carries it out.
export interface FileEdit {
  path: string
  before: string | null // text read when planning; null = file absent
  after: string | null // null = delete
  previewOnly?: boolean // shown in review, written by a command instead (Claude Code ~/.claude.json)
}

export interface WritePlan {
  edits: FileEdit[]
  moves: { from: string; to: string }[] // files or folders
  copies: { from: string; to: string }[] // files or folders
  removals: string[] // files or folders, moved into the backup instead of deleted
  commands: { argv: string[]; touches: string[]; cwd?: string }[] // touches = files backed up before the command runs
  notices: string[] // shown after apply, e.g. "Restart Claude Code sessions to load this change."
}
