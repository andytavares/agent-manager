import { basename } from "node:path"
import { useEffect, useState } from "react"
import { HARNESS_LABELS, type HarnessAdapter, type Item, type ItemDetail, type McpServer } from "../core/model"
import { maskSecret } from "../core/registry"
import { skillChecks } from "../core/skills"
import { backlinks } from "../memory/entry"
import { isBrokenLink, knownNames } from "../memory/health"
import type { AutoEntry } from "../memory/types"
import { shortPath } from "../memory/format"
import { tildePath } from "./ItemList"
import { ACCENT, DIM, theme } from "./theme"

interface DetailPaneProps {
  item: Item | undefined
  entry: AutoEntry | undefined // set when the selected row is an auto memory entry
  siblings: AutoEntry[] // every entry, so its links out and in can be resolved
  adapter: HarnessAdapter | undefined // the adapter of item.harness
  home: string
}

// The detail strip under the list: title, place and file on one line, the body under it.
export function DetailPane(props: DetailPaneProps) {
  const { item, adapter, home } = props
  // The detail remembers which item it belongs to, so the previous item's fields are never drawn under a new name.
  const [loaded, setLoaded] = useState<{ item: Item; detail: ItemDetail } | null>(null)
  const detail = loaded && loaded.item === item ? loaded.detail : null
  useEffect(() => {
    if (!item || !adapter) return
    let live = true
    adapter.read(item).then(
      (read) => live && setLoaded({ item, detail: read }),
      (error: Error) => live && setLoaded({ item, detail: { type: "text", text: `Cannot read: ${error.message}` } }),
    )
    return () => {
      live = false
    }
  }, [item, adapter])

  if (props.entry) return <EntryDetail entry={props.entry} siblings={props.siblings} home={home} />
  if (!item) return <text fg={DIM} wrapMode="none"> No item selected</text>
  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <text wrapMode="none">
        <span fg={ACCENT}><b>{item.name}</b></span>
        <span fg={DIM}>{`  ${HARNESS_LABELS[item.harness]} · ${item.scope}${stateText(item)}`}</span>
      </text>
      <text fg={theme.faint} wrapMode="none">{`${tildePath(item.path, home)}${item.key ? ` · ${item.key}` : ""}`}</text>
      {item.readOnly && <Field label="read-only" value={item.readOnly} />}
      {[...(item.warnings ?? []), ...checksOf(item, detail)].map((warning) => <text key={warning} fg={theme.warn} wrapMode="none">{`▲ ${warning}`}</text>)}
      {detail && <DetailBody detail={detail} />}
    </box>
  )
}

// Memory says whether it loads at start; MCP servers and plugins say whether they are on.
function stateText(item: Item): string {
  const on = item.loadedBy.length > 0
  if (item.kind === "memory") return ` · loaded at start ${on ? "✓" : "✗"}`
  if (item.kind === "mcp" || item.kind === "plugin") return on ? " · on ●" : " · off ○"
  return ""
}

// Auto memory entry: title and index line, the description, then its links out and in.
function EntryDetail({ entry, siblings, home }: { entry: AutoEntry; siblings: AutoEntry[]; home: string }) {
  const known = knownNames(siblings)
  const from = backlinks(siblings, entry)
  const loadedAtStart = entry.indexLine !== null && !entry.pastLoadLimit
  const broken = entry.links.some((link) => isBrokenLink(known, link))
  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <text wrapMode="none">
        <span fg={ACCENT}><b>{entry.title}</b></span>
        <span fg={DIM}>{`  ${entry.type ?? "-"} · ${indexText(entry)} · loaded at start `}</span>
        <span fg={loadedAtStart ? theme.ok : theme.err}>{loadedAtStart ? "✓" : "✗"}</span>
      </text>
      <text fg={theme.faint} wrapMode="none">{shortPath(tildePath(entry.path, home), 80)}</text>
      {entry.description !== "" && <text wrapMode="none">{entry.description}</text>}
      <text wrapMode="none">
        <span fg={DIM}>{"links out   "}</span>
        {entry.links.length === 0 ? <span fg={DIM}>nothing</span> : null}
        {entry.links.map((link) => (isBrokenLink(known, link) ? <span key={link} fg={theme.err}>{`[[${link}]] ▲ no such entry  `}</span> : <span key={link} fg={ACCENT}>{`[[${link}]]  `}</span>))}
      </text>
      <text wrapMode="none">
        <span fg={DIM}>{"linked from "}</span>
        {from.length ? from.map((e) => e.name).join(", ") : <span fg={DIM}>nothing</span>}
      </text>
      {broken && <text fg={DIM} wrapMode="none">5 open Health to unlink the broken link</text>}
    </box>
  )
}

const indexText = (entry: AutoEntry) => (entry.indexLine === null ? "not in MEMORY.md" : `MEMORY.md line ${entry.indexLine}`)

// Skill checks per harness that loads or can turn on the skill.
function checksOf(item: Item, detail: ItemDetail | null): string[] {
  if (item.kind !== "skill" || detail?.type !== "text") return []
  const readers = [...item.loadedBy, ...(item.offIn ?? [])]
  return readers.flatMap((id) => skillChecks(id, basename(item.path), detail.text).map((check) => `${HARNESS_LABELS[id]}: ${check}`))
}

function DetailBody({ detail }: { detail: ItemDetail }) {
  if (detail.type === "text") return <text>{detail.text}</text>
  if (detail.type === "mcp") return <McpFields server={detail.server} />
  return <box flexDirection="column">{detail.plugin.version && <Field label="version" value={detail.plugin.version} />}</box>
}

function McpFields({ server }: { server: McpServer }) {
  const command = [server.command, ...(server.args ?? [])].join(" ")
  return (
    <box flexDirection="column">
      {server.url && <Field label="url" value={server.url} />}
      {server.command && <Field label="command" value={command} />}
      {Object.entries(server.env ?? {}).map(([name, value]) => <SecretField key={name} label="env" name={name} value={value} />)}
      {Object.entries(server.headers ?? {}).map(([name, value]) => <SecretField key={name} label="header" name={name} value={value} />)}
    </box>
  )
}

const ENV_REF = /^\$\{[^}]+\}$/

// A ${VAR} value is read from the environment, so it shows as is; a literal value is masked.
function SecretField({ label, name, value }: { label: string; name: string; value: string }) {
  return (
    <text wrapMode="none">
      <span fg={DIM}>{label.padEnd(10)}</span>
      {`${name} = `}
      {ENV_REF.test(value) ? <span fg={theme.accent2}>{value}</span> : maskSecret(value)}
      {ENV_REF.test(value) && <span fg={DIM}>{" read from your environment"}</span>}
    </text>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <text wrapMode="none">
      <span fg={DIM}>{label.padEnd(10)}</span>
      {value}
    </text>
  )
}
