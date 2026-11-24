import { dirname } from "node:path"
import { stringify } from "yaml"
import { HARNESS_LABELS, type Change, type HarnessAdapter, type HarnessId, type Item, type McpServer, type PluginInfo, type ProjectData, type Roots, type Scope, type WritePlan } from "../core/model"
import { emptyPlan } from "../core/memory-plan"
import { skillRootChoices } from "../core/registry"
import { tildePath } from "./ItemList"
import type { McpTarget } from "./McpForm"
import type { PromptStep } from "./Prompt"

export type Screen =
  | { name: "list" }
  | { name: "prompt"; title: string; nextStep: (answers: string[]) => PromptStep | null; onDone: (answers: string[]) => void }
  | { name: "editor"; title: string; label?: string; initialText: string; toChange: (text: string) => Change } // label: "Harness · scope"
  | { name: "mcpForm"; title: string; server: McpServer; targets: McpTarget[]; fixed?: boolean; toChanges: (server: McpServer, targets: McpTarget[]) => Change[] }
  | { name: "review"; plan: WritePlan; secrets: string[] } // secrets: literal values masked until revealed
  | { name: "marketplaces"; marketplaces: Marketplace[] }
  | { name: "projects"; projects: ProjectData[] }

export interface Marketplace {
  harness: HarnessId
  name: string
  source: string
  installed: number // plugins installed from it
}

export interface FlowContext {
  adapters: HarnessAdapter[] // detected adapters only
  roots: Roots
  scope: "global" | "project"
  review: (...changes: Change[]) => void // plans each change and opens one review screen
  open: (screen: Screen) => void
  back: () => void // to the last list screen: the item list, projects or marketplaces
  notify: (text: string, error?: boolean) => void // one line under the panels
}

function target(item: Item) {
  return { harness: item.harness, scope: item.scope }
}

// Gives every step of a wizard the names of all its steps, for "Step n of N".
function withSteps(steps: string[], nextStep: (answers: string[]) => PromptStep | null) {
  return (answers: string[]): PromptStep | null => {
    const step = nextStep(answers)
    return step && { ...step, steps }
  }
}

export function deleteItem(item: Item, context: FlowContext): void {
  context.review({ kind: item.kind, op: "delete", target: target(item), item })
}

export async function editItem(item: Item, context: FlowContext): Promise<Screen> {
  const detail = await context.adapters.find((adapter) => adapter.id === item.harness)!.read(item)
  const initialText = detail.type === "text" ? detail.text : ""
  const title = item.kind === "skill" ? `${item.name}/SKILL.md` : item.name
  return { name: "editor", title, label: `${HARNESS_LABELS[item.harness]} · ${item.scope}`, initialText, toChange: (text) => ({ kind: item.kind, op: "update", target: target(item), item, text, before: initialText }) }
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
  const harnessOption = (adapter: HarnessAdapter) => ({ name: adapter.label, description: memoryChoices(adapter, context.scope).map((choice) => choice.name).join(", "), value: adapter.id })
  const nextStep = ([harness, file, name, type, description]: string[]): PromptStep | null => {
    if (!harness) return { label: "Which harness should load it?", hint: "Only harnesses found on this machine are listed.", options: adapters.map(harnessOption) }
    if (!file) return { label: "Which file?", hint: "You write its text on the next screen.", options: memoryChoices(adapterOf(harness), context.scope) }
    if (file.includes("<name>") && !name) return { label: "What is it called?", hint: "The name replaces <name> in the file path." }
    if (!isAutoEntry(file)) return null
    if (!type) return { label: "Which type of memory?", options: MEMORY_TYPES.map((value) => ({ name: value, description: "", value })) }
    return description === undefined ? { label: "Describe it in one line.", hint: "Claude Code reads it to decide when the memory applies." } : null
  }
  const onDone = ([harness, file, name, type, description]: string[]) => {
    const separator = file!.indexOf(":")
    const scope = file!.slice(0, separator) as Scope
    const fileName = file!.slice(separator + 1).replace("<name>", name ?? "")
    const initialText = isAutoEntry(file!) ? `---\n${stringify({ name, description, metadata: { type } })}---\n\n` : ""
    const toChange = (text: string): Change => ({ kind: "memory", op: "create", target: { harness: adapterOf(harness!).id, scope }, name: fileName, text })
    context.open({ name: "editor", title: fileName, label: `${adapterOf(harness!).label} · ${scope}`, initialText, toChange })
  }
  return { name: "prompt", title: "Add memory", nextStep: withSteps(["Harness", "File", "Name", "Type", "Description"], nextStep), onDone }
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
    if (!name) return { label: "What is the skill called?", hint: "The name is also its folder name." }
    if (!description) return { label: "Describe what it does in one line.", hint: "Harnesses read it to decide when to use the skill." }
    return root ? null : { label: "Which folder should hold it?", hint: "Each folder lists the harnesses that read it.", options: rootOptions(choices, context.roots.home) }
  }
  const onDone = ([name, description, root]: string[]) => {
    const readers = choices.find((choice) => choice.path === root)!.readers
    const text = `---\n${stringify({ name, description })}---\n`
    const harness = readers[0] ?? context.adapters[0]!.id
    context.review({ kind: "skill", op: "create", target: { harness, scope: context.scope }, name, text, destination: root })
  }
  return { name: "prompt", title: "New skill", nextStep: withSteps(["Name", "Description", "Folder"], nextStep), onDone }
}

// op "copy" or "move": to another root of the same scope.
export async function relocateSkill(item: Item, op: "copy" | "move", context: FlowContext): Promise<Screen> {
  const choices = (await skillRootChoices(context.adapters, context.roots, context.scope)).filter((choice) => choice.path !== dirname(item.path))
  const verb = op === "copy" ? "Copy" : "Move"
  const step = { label: `${verb} it to which folder?`, hint: relocateHint(item, op, context.roots.home), options: rootOptions(choices, context.roots.home) }
  return {
    name: "prompt",
    title: `${verb} skill ${item.name}`,
    nextStep: withSteps(["Destination"], (answers) => (answers.length ? null : step)),
    onDone: ([destination]) => context.review({ kind: "skill", op, target: target(item), item, destination }),
  }
}

// A plugin skill is read-only: moving or copying it makes a copy the user owns.
function relocateHint(item: Item, op: "copy" | "move", home: string): string {
  if (!item.readOnly?.startsWith("from plugin")) return `It is now in ${tildePath(dirname(item.path), home)}.`
  return `${item.name} comes ${item.readOnly}. ${op === "copy" ? "Copying" : "Moving"} it makes a copy you own.`
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
  return { name: "mcpForm", title: `Edit MCP server ${item.name}`, server, targets: [{ ...target(item), checked: true }], fixed: true, toChanges }
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

function harnessOptions(adapters: HarnessAdapter[], describe: (adapter: HarnessAdapter) => string = () => "") {
  return adapters.map((adapter) => ({ name: adapter.label, description: describe(adapter), value: adapter.id }))
}

export const countOf = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`

// Without a catalog the name is free text; known marketplace names are shown as a hint.
async function installPlugin(context: FlowContext): Promise<Screen> {
  const adapterOf = (id: string) => context.adapters.find((adapter) => adapter.id === id)!
  const names = new Map<string, string[]>()
  for (const adapter of context.adapters) names.set(adapter.id, (await adapter.marketplaces?.(context.roots))?.map((marketplace) => marketplace.name) ?? [])
  const nameHint = (harness: string) => (names.get(harness)!.length ? `Write name@marketplace. Known marketplaces: ${names.get(harness)!.join(", ")}` : "Write the plugin name.")
  const nextStep = ([harness, scope, name]: string[]): PromptStep | null => {
    if (!harness) return { label: "Install for which harness?", hint: "Each harness shows how many marketplaces it knows.", options: harnessOptions(context.adapters, (adapter) => countOf(names.get(adapter.id)!.length, "marketplace")) }
    if (!scope) return { label: "Install at which scope?", options: adapterOf(harness).scopes.map((value) => ({ name: value, description: "", value })) }
    return name ? null : { label: "Which plugin?", hint: nameHint(harness) }
  }
  const onDone = ([harness, scope, name]: string[]) =>
    context.review({ kind: "plugin", op: "create", target: { harness: harness as HarnessId, scope: scope as Scope }, plugin: { name: name!, enabled: true } })
  return { name: "prompt", title: "Install plugin", nextStep: withSteps(["Harness", "Scope", "Plugin"], nextStep), onDone }
}

export async function marketplaceList(context: FlowContext): Promise<Screen> {
  const lists = await Promise.all(context.adapters.map((adapter) => marketplacesOf(adapter, context.roots)))
  return { name: "marketplaces", marketplaces: lists.flat() }
}

// A plugin comes from the marketplace its "@<marketplace>" suffix names.
async function marketplacesOf(adapter: HarnessAdapter, roots: Roots): Promise<Marketplace[]> {
  const entries = (await adapter.marketplaces?.(roots)) ?? []
  if (!entries.length) return []
  const plugins = await adapter.list("plugin", roots)
  const installed = (name: string) => plugins.filter((plugin) => plugin.name.endsWith(`@${name}`)).length
  return entries.map((entry) => ({ ...entry, harness: adapter.id, installed: installed(entry.name) }))
}

function marketplaceTarget(harness: HarnessId, context: FlowContext) {
  return { harness, scope: viewScope(context.adapters.find((adapter) => adapter.id === harness)!, context.scope) }
}

export function addMarketplace(context: FlowContext): Screen {
  const adapters = context.adapters.filter((adapter) => adapter.marketplaces)
  const nextStep = ([harness, source]: string[]): PromptStep | null => {
    if (!harness) return { label: "Add it to which harness?", hint: "Only harnesses that use marketplaces are listed.", options: harnessOptions(adapters) }
    return source ? null : { label: "Where is the marketplace?", hint: "owner/repo, a git URL or a local path" }
  }
  const onDone = ([harness, source]: string[]) =>
    context.review({ kind: "plugin", op: "create", target: marketplaceTarget(harness as HarnessId, context), marketplace: source })
  return { name: "prompt", title: "Add marketplace", nextStep: withSteps(["Harness", "Source"], nextStep), onDone }
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
  U: (item, context) => updatePlugin(item, context, false),
  x: async (item, context) => deleteItem(item, context),
}

// Plugin keys on the list; undefined when the key is not an action.
export function runPluginAction(name: string, item: Item | undefined, context: FlowContext): Promise<Screen | void> | undefined {
  if (name === "i") return installPlugin(context)
  if (name === "m") return marketplaceList(context)
  const action = PLUGIN_ITEM_ACTIONS[name]
  return item && action ? action(item, context) : undefined
}

export async function projectList(context: FlowContext): Promise<Screen> {
  const lists = await Promise.all(context.adapters.map((adapter) => adapter.projects?.(context.roots) ?? []))
  return { name: "projects", projects: lists.flat() }
}

// Only the harness's data folders go; the project folders stay. apply moves them into the backup.
export function deleteProjects(projects: ProjectData[], context: FlowContext): void {
  context.open({ name: "review", plan: { ...emptyPlan(), removals: projects.map((project) => project.dataDir) }, secrets: [] })
}
