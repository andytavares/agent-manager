import { dirname } from "node:path"
import { stringify } from "yaml"
import { HARNESS_LABELS, type Change, type HarnessAdapter, type HarnessId, type Item, type McpServer, type PluginInfo, type Roots, type Scope, type WritePlan } from "../core/model"
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
  | { name: "marketplaces"; marketplaces: Marketplace[] }

export interface Marketplace {
  harness: HarnessId
  name: string
  source: string
}

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
  return { name: "editor", title, initialText, toChange: (text) => ({ kind: item.kind, op: "update", target: target(item), item, text, before: initialText }) }
}

// Project view adds Claude Code's local scope next to project.
function memoryChoices(adapter: HarnessAdapter, scope: FlowContext["scope"]) {
  const scopes: Scope[] = scope === "global" ? ["global"] : ["project", "local"]
  return scopes.flatMap((fileScope) =>
    (adapter.memoryFiles[fileScope] ?? []).map((file) => ({ name: file, description: fileScope, value: `${fileScope}:${file}` })),
  )
}

// Claude Code auto memory entries carry name, description and metadata.type frontmatter.
const MEMORY_TYPES = ["user", "feedback", "project", "reference"]
const isAutoEntry = (file: string) => file.endsWith(":memory/<name>.md")

export function addMemory(context: FlowContext): Screen {
  const adapters = context.adapters.filter((adapter) => memoryChoices(adapter, context.scope).length > 0)
  const adapterOf = (id: string) => adapters.find((adapter) => adapter.id === id)!
  const nextStep = ([harness, file, name, type, description]: string[]): PromptStep | null => {
    if (!harness) return { label: "Harness", options: adapters.map((adapter) => ({ name: adapter.label, description: "", value: adapter.id })) }
    if (!file) return { label: "File", options: memoryChoices(adapterOf(harness), context.scope) }
    if (file.includes("<name>") && !name) return { label: "Name" }
    if (!isAutoEntry(file)) return null
    if (!type) return { label: "Type", options: MEMORY_TYPES.map((value) => ({ name: value, description: "", value })) }
    return description === undefined ? { label: "Description" } : null
  }
  const onDone = ([harness, file, name, type, description]: string[]) => {
    const separator = file!.indexOf(":")
    const scope = file!.slice(0, separator) as Scope
    const fileName = file!.slice(separator + 1).replace("<name>", name ?? "")
    const initialText = isAutoEntry(file!) ? `---\n${stringify({ name, description, metadata: { type } })}---\n\n` : ""
    const toChange = (text: string): Change => ({ kind: "memory", op: "create", target: { harness: adapterOf(harness!).id, scope }, name: fileName, text })
    context.open({ name: "editor", title: fileName, initialText, toChange })
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

// The view's scope when the harness has it, else the harness's first scope.
function viewScope(adapter: HarnessAdapter, scope: Scope): Scope {
  return adapter.scopes.includes(scope) ? scope : adapter.scopes[0]!
}

// Unchecked, at the view's scope when the harness has it.
function mcpTargets(adapters: HarnessAdapter[], scope: Scope): McpTarget[] {
  return adapters.map((adapter) => ({ harness: adapter.id, scope: viewScope(adapter, scope), checked: false }))
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
  // native keys belong to the source harness's format, so a copy starts without them.
  const server = { ...(await readServer(item, context)), native: {} }
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

async function readPlugin(item: Item, context: FlowContext): Promise<PluginInfo> {
  const detail = await context.adapters.find((adapter) => adapter.id === item.harness)!.read(item)
  if (detail.type !== "plugin") throw new Error(`${item.name} is not a plugin.`)
  return detail.plugin
}

function harnessOptions(adapters: HarnessAdapter[]) {
  return adapters.map((adapter) => ({ name: adapter.label, description: "", value: adapter.id }))
}

// Without a catalog the name is free text; known marketplace names are shown as a hint.
async function installPlugin(context: FlowContext): Promise<Screen> {
  const adapterOf = (id: string) => context.adapters.find((adapter) => adapter.id === id)!
  const hints = new Map<string, string>()
  for (const adapter of context.adapters) {
    const names = (await adapter.marketplaces?.(context.roots))?.map((marketplace) => marketplace.name) ?? []
    hints.set(adapter.id, names.length ? `  (marketplaces: ${names.join(", ")})` : "")
  }
  const nextStep = ([harness, scope, name]: string[]): PromptStep | null => {
    if (!harness) return { label: "Harness", options: harnessOptions(context.adapters) }
    if (!scope) return { label: "Scope", options: adapterOf(harness).scopes.map((value) => ({ name: value, description: "", value })) }
    return name ? null : { label: `Plugin name${hints.get(harness)}` }
  }
  const onDone = ([harness, scope, name]: string[]) =>
    context.review({ kind: "plugin", op: "create", target: { harness: harness as HarnessId, scope: scope as Scope }, plugin: { name: name!, enabled: true } })
  return { name: "prompt", title: "Install plugin", nextStep, onDone }
}

async function marketplaceList(context: FlowContext): Promise<Screen> {
  const lists = await Promise.all(
    context.adapters.map(async (adapter) => ((await adapter.marketplaces?.(context.roots)) ?? []).map((entry) => ({ ...entry, harness: adapter.id }))),
  )
  return { name: "marketplaces", marketplaces: lists.flat() }
}

function marketplaceTarget(harness: HarnessId, context: FlowContext) {
  return { harness, scope: viewScope(context.adapters.find((adapter) => adapter.id === harness)!, context.scope) }
}

export function addMarketplace(context: FlowContext): Screen {
  const adapters = context.adapters.filter((adapter) => adapter.marketplaces)
  const nextStep = ([harness, source]: string[]): PromptStep | null => {
    if (!harness) return { label: "Harness", options: harnessOptions(adapters) }
    return source ? null : { label: "Source (owner/repo, git URL or path)" }
  }
  const onDone = ([harness, source]: string[]) =>
    context.review({ kind: "plugin", op: "create", target: marketplaceTarget(harness as HarnessId, context), marketplace: source })
  return { name: "prompt", title: "Add marketplace", nextStep, onDone }
}

export function removeMarketplace(marketplace: Marketplace, context: FlowContext): void {
  context.review({ kind: "plugin", op: "delete", target: marketplaceTarget(marketplace.harness, context), marketplace: marketplace.name })
}

// flip turns the plugin on or off; otherwise enabled stays and adapters plan a version update.
async function updatePlugin(item: Item, context: FlowContext, flip: boolean): Promise<void> {
  const plugin = await readPlugin(item, context)
  context.review({ kind: "plugin", op: "update", target: target(item), item, plugin: { ...plugin, enabled: flip ? !plugin.enabled : plugin.enabled } })
}

const PLUGIN_ITEM_ACTIONS: Record<string, (item: Item, context: FlowContext) => Promise<Screen | void>> = {
  space: (item, context) => updatePlugin(item, context, true),
  u: (item, context) => updatePlugin(item, context, false),
  x: async (item, context) => deleteItem(item, context),
}

// Plugin keys on the list; undefined when the key is not an action.
export function runPluginAction(name: string, item: Item | undefined, context: FlowContext): Promise<Screen | void> | undefined {
  if (name === "i") return installPlugin(context)
  if (name === "m") return marketplaceList(context)
  const action = PLUGIN_ITEM_ACTIONS[name]
  return item && action ? action(item, context) : undefined
}
