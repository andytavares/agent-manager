import { dirname } from "node:path"
import { stringify } from "yaml"
import { HARNESS_LABELS, type Change, type HarnessAdapter, type Item, type McpServer, type Roots, type Scope, type WritePlan } from "../core/model"
import { skillRootChoices } from "../core/registry"
import { tildePath } from "./ItemList"
import type { McpTarget } from "./McpForm"
import type { PromptStep } from "./Prompt"

export type Screen =
  | { name: "list" }
  | { name: "prompt"; title: string; nextStep: (answers: string[]) => PromptStep | null; onDone: (answers: string[]) => void }
  | { name: "editor"; title: string; initialText: string; toChange: (text: string) => Change }
  | { name: "mcpForm"; title: string; server: McpServer; targets: McpTarget[]; fixed?: boolean; toChanges: (server: McpServer, targets: McpTarget[]) => Change[] }
  | { name: "review"; plan: WritePlan; secrets: string[] } // secrets: literal values masked until revealed

export interface FlowContext {
  adapters: HarnessAdapter[] // detected adapters only
  roots: Roots
  scope: "global" | "project"
  review: (...changes: Change[]) => void // plans each change and opens one review screen
  open: (screen: Screen) => void
}

function target(item: Item) {
  return { harness: item.harness, scope: item.scope }
}

export function deleteItem(item: Item, context: FlowContext): void {
  context.review({ kind: item.kind, op: "delete", target: target(item), item })
}

export async function editItem(item: Item, context: FlowContext): Promise<Screen> {
  const detail = await context.adapters.find((adapter) => adapter.id === item.harness)!.read(item)
  const initialText = detail.type === "text" ? detail.text : ""
  const title = item.kind === "skill" ? `${item.name}/SKILL.md` : item.name
  return { name: "editor", title, initialText, toChange: (text) => ({ kind: item.kind, op: "update", target: target(item), item, text }) }
}

// Project view adds Claude Code's local scope next to project.
function memoryChoices(adapter: HarnessAdapter, scope: FlowContext["scope"]) {
  const scopes: Scope[] = scope === "global" ? ["global"] : ["project", "local"]
  return scopes.flatMap((fileScope) =>
    (adapter.memoryFiles[fileScope] ?? []).map((file) => ({ name: file, description: fileScope, value: `${fileScope}:${file}` })),
  )
}

export function addMemory(context: FlowContext): Screen {
  const adapters = context.adapters.filter((adapter) => memoryChoices(adapter, context.scope).length > 0)
  const adapterOf = (id: string) => adapters.find((adapter) => adapter.id === id)!
  const nextStep = ([harness, file, name]: string[]): PromptStep | null => {
    if (!harness) return { label: "Harness", options: adapters.map((adapter) => ({ name: adapter.label, description: "", value: adapter.id })) }
    if (!file) return { label: "File", options: memoryChoices(adapterOf(harness), context.scope) }
    return file.includes("<name>") && !name ? { label: "Name" } : null
  }
  const onDone = ([harness, file, name]: string[]) => {
    const separator = file!.indexOf(":")
    const scope = file!.slice(0, separator) as Scope
    const fileName = file!.slice(separator + 1).replace("<name>", name ?? "")
    const toChange = (text: string): Change => ({ kind: "memory", op: "create", target: { harness: adapterOf(harness!).id, scope }, name: fileName, text })
    context.open({ name: "editor", title: fileName, initialText: "", toChange })
  }
  return { name: "prompt", title: "Add memory", nextStep, onDone }
}

function rootOptions(choices: Awaited<ReturnType<typeof skillRootChoices>>, home: string) {
  return choices.map((choice) => ({
    name: tildePath(choice.path, home),
    description: `read by ${choice.readers.map((id) => HARNESS_LABELS[id]).join(", ") || "no harness"}`,
    value: choice.path,
  }))
}

export async function newSkill(context: FlowContext): Promise<Screen> {
  const choices = await skillRootChoices(context.adapters, context.roots, context.scope)
  const nextStep = ([name, description, root]: string[]): PromptStep | null => {
    if (!name) return { label: "Name (folder name)" }
    if (!description) return { label: "Description" }
    return root ? null : { label: "Root", options: rootOptions(choices, context.roots.home) }
  }
  const onDone = ([name, description, root]: string[]) => {
    const readers = choices.find((choice) => choice.path === root)!.readers
    const text = `---\n${stringify({ name, description })}---\n`
    const harness = readers[0] ?? context.adapters[0]!.id
    context.review({ kind: "skill", op: "create", target: { harness, scope: context.scope }, name, text, destination: root })
  }
  return { name: "prompt", title: "New skill", nextStep, onDone }
}

// op "copy" or "move": to another root of the same scope.
export async function relocateSkill(item: Item, op: "copy" | "move", context: FlowContext): Promise<Screen> {
  const choices = (await skillRootChoices(context.adapters, context.roots, context.scope)).filter((choice) => choice.path !== dirname(item.path))
  const options = rootOptions(choices, context.roots.home)
  return {
    name: "prompt",
    title: `${op === "copy" ? "Copy" : "Move"} ${item.name} to…`,
    nextStep: (answers) => (answers.length ? null : { label: "Root", options }),
    onDone: ([destination]) => context.review({ kind: "skill", op, target: target(item), item, destination }),
  }
}

const EMPTY_SERVER: McpServer = { name: "", transport: "stdio", enabled: true, native: {} }

async function readServer(item: Item, context: FlowContext): Promise<McpServer> {
  const detail = await context.adapters.find((adapter) => adapter.id === item.harness)!.read(item)
  if (detail.type !== "mcp") throw new Error(`${item.name} is not an MCP server.`)
  return detail.server
}

// Unchecked, at the view's scope when the harness has it.
function mcpTargets(adapters: HarnessAdapter[], scope: Scope): McpTarget[] {
  return adapters.map((adapter) => ({ harness: adapter.id, scope: adapter.scopes.includes(scope) ? scope : adapter.scopes[0]!, checked: false }))
}

function createChanges(server: McpServer, targets: McpTarget[]): Change[] {
  return targets.map(({ harness, scope }) => ({ kind: "mcp", op: "create", target: { harness, scope }, server }))
}

function addMcp(context: FlowContext): Screen {
  return { name: "mcpForm", title: "Add MCP server", server: EMPTY_SERVER, targets: mcpTargets(context.adapters, context.scope), toChanges: createChanges }
}

async function editMcp(item: Item, context: FlowContext): Promise<Screen> {
  const server = await readServer(item, context)
  const toChanges = (edited: McpServer): Change[] => [{ kind: "mcp", op: "update", target: target(item), item, server: edited }]
  return { name: "mcpForm", title: `Edit ${item.name}`, server, targets: [{ ...target(item), checked: true }], fixed: true, toChanges }
}

async function copyMcp(item: Item, context: FlowContext): Promise<Screen> {
  const server = await readServer(item, context)
  const others = context.adapters.filter((adapter) => adapter.id !== item.harness)
  return { name: "mcpForm", title: `Copy ${item.name} to…`, server, targets: mcpTargets(others, context.scope), toChanges: createChanges }
}

async function toggleMcp(item: Item, context: FlowContext): Promise<void> {
  const server = await readServer(item, context)
  context.review({ kind: "mcp", op: "update", target: target(item), item, server: { ...server, enabled: !server.enabled } })
}

// The server rides along only so that review can mask its secrets.
async function deleteMcp(item: Item, context: FlowContext): Promise<void> {
  context.review({ kind: "mcp", op: "delete", target: target(item), item, server: await readServer(item, context) })
}

const MCP_ITEM_ACTIONS: Record<string, (item: Item, context: FlowContext) => Promise<Screen | void>> = {
  e: editMcp,
  return: editMcp,
  c: copyMcp,
  d: deleteMcp,
  space: toggleMcp,
}

// MCP keys on the list; undefined when the key is not an action.
export function runMcpAction(name: string, item: Item | undefined, context: FlowContext): Screen | Promise<Screen | void> | undefined {
  if (name === "a") return addMcp(context)
  const action = MCP_ITEM_ACTIONS[name]
  return item && action ? action(item, context) : undefined
}
