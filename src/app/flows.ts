import { dirname } from "node:path"
import { stringify } from "yaml"
import { HARNESS_LABELS, type Change, type HarnessAdapter, type Item, type Roots, type Scope, type WritePlan } from "../core/model"
import { skillRootChoices } from "../core/registry"
import { tildePath } from "./ItemList"
import type { PromptStep } from "./Prompt"

export type Screen =
  | { name: "list" }
  | { name: "prompt"; title: string; nextStep: (answers: string[]) => PromptStep | null; onDone: (answers: string[]) => void }
  | { name: "editor"; title: string; initialText: string; toChange: (text: string) => Change }
  | { name: "review"; plan: WritePlan }

export interface FlowContext {
  adapters: HarnessAdapter[] // detected adapters only
  roots: Roots
  scope: "global" | "project"
  review: (change: Change) => void // plans the change and opens the review screen
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
