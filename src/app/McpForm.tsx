import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useEffect, useReducer } from "react"
import { HARNESS_LABELS, type HarnessAdapter, type HarnessId, type McpServer, type Scope } from "../core/model"
import { literalSecrets } from "../core/registry"
import { Dialog } from "./Dialog"
import { ACCENT, DIM, theme } from "./theme"

export interface McpTarget {
  harness: HarnessId
  scope: Scope
  checked: boolean
}

interface McpFormProps {
  title: string
  server: McpServer
  targets: McpTarget[]
  adapters: HarnessAdapter[] // gives each target its scope choices
  fixed?: boolean // edit: the one target cannot change
  onSubmit: (server: McpServer, targets: McpTarget[]) => void
  onCancel: () => void
}

type TextField = "name" | "command" | "args" | "env" | "url" | "headers"
type Values = Record<TextField, string> & { transport: McpServer["transport"]; enabled: boolean }

const TRANSPORTS: McpServer["transport"][] = ["stdio", "http", "sse"]
const LABELS: Record<TextField, string> = { name: "Name", command: "Command", args: "Args", env: "Env", url: "URL", headers: "Headers" }
const FORM_WIDTH = 96
const FIELD_WIDTH = 50
const LABEL_WIDTH = 12

// Static hint of what a target touches; the review shows the real plan.
const RESULT_HINTS: Record<HarnessId, Partial<Record<Scope, string>>> = {
  "claude-code": { global: "claude mcp add-json -s user", project: "claude mcp add-json -s project", local: "claude mcp add-json -s local" },
  codex: { global: "~/.codex/config.toml", project: ".codex/config.toml" },
  opencode: { global: "~/.config/opencode/opencode.json", project: "opencode.json" },
  omp: { global: "~/.omp/agent/mcp.json", project: ".omp/mcp.json" },
}

interface FormState {
  values: Values
  targets: McpTarget[]
  focusIndex: number
  submitted: boolean // enter on a form with a name and a checked target
  attempted: boolean // enter was pressed, so the form marks each bad field
}

type FormAction = { type: "key"; name: string; shift: boolean } | { type: "input"; field: TextField; value: string }

interface FormRules {
  scopesOf: (harness: HarnessId) => Scope[]
  fixed?: boolean
}

// tab/shift+tab move between fields, space toggles, ←→ change transport or scope, enter plans, esc cancels.
// A reducer, so that keys pressed before the next render see the latest state.
export function McpForm({ title, server, targets, adapters, fixed, onSubmit, onCancel }: McpFormProps) {
  const rules: FormRules = { scopesOf: (harness) => adapters.find((adapter) => adapter.id === harness)?.scopes ?? [], fixed }
  const [state, dispatch] = useReducer((current: FormState, action: FormAction) => reduceForm(current, action, rules), {
    values: valuesOf(server), targets, focusIndex: 0, submitted: false, attempted: false,
  })
  const { width } = useTerminalDimensions()
  useEffect(() => {
    if (state.submitted) onSubmit(serverOf(server, state.values), state.targets.filter((target) => target.checked))
  }, [state.submitted])
  useKeyboard((key) => (key.name === "escape" ? onCancel() : dispatch({ type: "key", name: key.name, shift: key.shift })))
  const notes = fieldNotes(state, server)
  return (
    <Dialog title={title} width={Math.min(FORM_WIDTH, width - 4)}>
      <text> </text>
      <ServerFields state={state} notes={notes} dispatch={dispatch} />
      <text> </text>
      <WriteTo state={state} fixed={fixed} error={notes.targets} />
      <text fg={theme.err}>{fixMessage(notes)}</text>
    </Dialog>
  )
}

interface FieldNote {
  text: string
  error?: boolean
}

type FieldNotes = Partial<Record<TextField | "targets", FieldNote>>

interface ServerFieldsProps {
  state: FormState
  notes: FieldNotes
  dispatch: (action: FormAction) => void
}

function ServerFields({ state, notes, dispatch }: ServerFieldsProps) {
  const { values } = state
  const focus = fieldsOf(values.transport, state.targets.length)[state.focusIndex]
  const input = (field: TextField) => (
    <Row key={field} label={LABELS[field]} focused={focus === field}>
      <input width={FIELD_WIDTH} value={values[field]} focused={focus === field} backgroundColor={theme.bg} focusedBackgroundColor={theme.selBg} onInput={(value) => dispatch({ type: "input", field, value })} />
      <Note note={notes[field]} />
    </Row>
  )
  return (
    <>
      <text fg={DIM}>SERVER</text>
      {input("name")}
      <Row label="Type" focused={focus === "transport"}>
        <Choices options={TRANSPORTS} selected={values.transport} />
        <Note note={{ text: "←→ change" }} />
      </Row>
      {values.transport === "stdio" ? [input("command"), input("args"), input("env")] : [input("url"), input("headers")]}
      <text fg={DIM}>
        {`${" ".repeat(LABEL_WIDTH + 1)}Write `}
        <span fg={theme.accent2}>{"${VAR}"}</span>
        {" to keep a secret out of the file."}
      </text>
      <Row label="Enabled" focused={focus === "enabled"}>
        <text>{values.enabled ? "[x] on" : "[ ] off"}</text>
      </Row>
    </>
  )
}

// After enter, a missing name or harness is an error; a literal secret is always flagged.
function fieldNotes(state: FormState, server: McpServer): FieldNotes {
  const pairsField = state.values.transport === "stdio" ? "env" : "headers"
  const pairsNote = literalSecrets(serverOf(server, state.values)).length ? { text: "▲ literal value", error: true } : { text: "KEY=VALUE, comma separated" }
  const notes: FieldNotes = { [pairsField]: pairsNote }
  if (state.attempted && !state.values.name.trim()) notes.name = { text: "▲ Name is required", error: true }
  if (state.attempted && !state.targets.some((target) => target.checked)) notes.targets = { text: "▲ Pick at least one harness", error: true }
  return notes
}

function fixMessage(notes: FieldNotes): string {
  const count = Object.values(notes).filter((note) => note?.text.startsWith("▲ ") && note.text !== "▲ literal value").length
  return count ? `▲ Fix ${count} ${count === 1 ? "field" : "fields"} to continue.` : " "
}

function reduceForm(state: FormState, action: FormAction, rules: FormRules): FormState {
  if (action.type === "input") return { ...state, values: { ...state.values, [action.field]: action.value } }
  const fieldCount = fieldsOf(state.values.transport, state.targets.length).length
  if (action.name === "tab") return { ...state, focusIndex: (state.focusIndex + (action.shift ? -1 : 1) + fieldCount) % fieldCount }
  if (action.name === "return") return { ...state, attempted: true, submitted: Boolean(state.values.name.trim()) && state.targets.some((target) => target.checked) }
  if (action.name === "space" || action.name === "left" || action.name === "right") return changeFocused(state, action.name, rules)
  return state
}

// space toggles; left and right cycle. Text fields ignore both.
function changeFocused(state: FormState, name: string, { scopesOf, fixed }: FormRules): FormState {
  const focus = fieldsOf(state.values.transport, state.targets.length)[state.focusIndex]!
  const direction = name === "left" ? -1 : 1
  const values = state.values
  if (focus === "transport") return { ...state, values: { ...values, transport: cycle(TRANSPORTS, values.transport, direction) } }
  if (focus === "enabled" && name === "space") return { ...state, values: { ...values, enabled: !values.enabled } }
  if (!focus.startsWith("target:") || fixed) return state
  const index = Number(focus.slice("target:".length))
  const change = (target: McpTarget): McpTarget =>
    name === "space" ? { ...target, checked: !target.checked } : { ...target, scope: cycle(scopesOf(target.harness), target.scope, direction) }
  return { ...state, targets: state.targets.map((target, at) => (at === index ? change(target) : target)) }
}

function fieldsOf(transport: McpServer["transport"], targetCount: number): string[] {
  const connection = transport === "stdio" ? ["command", "args", "env"] : ["url", "headers"]
  return ["name", "transport", ...connection, "enabled", ...Array.from({ length: targetCount }, (_, index) => `target:${index}`)]
}

function cycle<T>(options: T[], current: T, direction: number): T {
  return options[(options.indexOf(current) + direction + options.length) % options.length] ?? current
}

function valuesOf(server: McpServer): Values {
  return {
    name: server.name,
    transport: server.transport,
    enabled: server.enabled,
    command: server.command ?? "",
    args: (server.args ?? []).join(" "),
    env: formatPairs(server.env),
    url: server.url ?? "",
    headers: formatPairs(server.headers),
  }
}

function serverOf(base: McpServer, values: Values): McpServer {
  const { command: _command, args: _args, env: _env, url: _url, headers: _headers, ...rest } = base
  const args = values.args.split(/\s+/).filter(Boolean)
  const env = parsePairs(values.env)
  const headers = parsePairs(values.headers)
  const connection =
    values.transport === "stdio"
      ? { command: values.command.trim(), ...(args.length && { args }), ...(env && { env }) }
      : { url: values.url.trim(), ...(headers && { headers }) }
  return { ...rest, name: values.name.trim(), transport: values.transport, enabled: values.enabled, ...connection }
}

function formatPairs(pairs: Record<string, string> | undefined): string {
  return Object.entries(pairs ?? {})
    .map(([name, value]) => `${name}=${value}`)
    .join(", ")
}

// shortcut: a value cannot contain a comma; switch to one pair per line if a server needs one.
function parsePairs(text: string): Record<string, string> | undefined {
  const pairs = text
    .split(",")
    .map((pair) => pair.trim())
    .filter((pair) => pair.includes("="))
    .map((pair) => [pair.slice(0, pair.indexOf("=")).trim(), pair.slice(pair.indexOf("=") + 1).trim()])
  return pairs.length ? Object.fromEntries(pairs) : undefined
}

// The focused field's label gets the accent bar.
function Row({ label, focused, children }: { label: string; focused: boolean; children: React.ReactNode }) {
  return (
    <box flexDirection="row">
      <text fg={ACCENT}>{focused ? "▌" : " "}</text>
      <text fg={focused ? theme.text : DIM}>{label.padEnd(LABEL_WIDTH)}</text>
      {children}
    </box>
  )
}

function Note({ note }: { note?: FieldNote }) {
  return note ? <text fg={note.error ? theme.err : DIM}>{`  ${note.text}`}</text> : null
}

function Choices({ options, selected }: { options: string[]; selected: string }) {
  return (
    <text>
      {options.map((option) => (
        <span key={option} fg={option === selected ? theme.bg : DIM} bg={option === selected ? ACCENT : undefined}>
          {` ${option} `}
        </span>
      ))}
    </text>
  )
}

function WriteTo({ state, fixed, error }: { state: FormState; fixed?: boolean; error?: FieldNote }) {
  const focus = fieldsOf(state.values.transport, state.targets.length)[state.focusIndex]
  return (
    <>
      <text fg={DIM}>
        {"WRITE TO  "}
        {fixed ? "an edit stays in its file" : error && <span fg={theme.err}>{error.text}</span>}
      </text>
      {state.targets.map((target, index) => (
        <TargetRow key={target.harness} target={target} focused={focus === `target:${index}`} fixed={fixed} />
      ))}
    </>
  )
}

// ‹ › show that ←→ change the scope; a fixed target cannot change it.
function TargetRow({ target, focused, fixed }: { target: McpTarget; focused: boolean; fixed?: boolean }) {
  const scope = target.scope[0]!.toUpperCase() + target.scope.slice(1)
  return (
    <box flexDirection="row" backgroundColor={focused ? theme.selBg : undefined}>
      <text fg={ACCENT}>{focused ? "▌" : " "}</text>
      <text>
        {`  ${target.checked ? "[x]" : "[ ]"} ${HARNESS_LABELS[target.harness].padEnd(14)}${(fixed ? `${scope}  ` : `‹ ${scope} ›`).padEnd(12)}`}
        <span fg={DIM}>{RESULT_HINTS[target.harness][target.scope] ?? ""}</span>
      </text>
    </box>
  )
}
