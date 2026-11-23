import { basename } from "node:path"
import { useEffect, useState } from "react"
import { HARNESS_LABELS, type HarnessAdapter, type Item, type ItemDetail, type McpServer } from "../core/model"
import { maskSecret } from "../core/registry"
import { skillChecks } from "../core/skills"
import { backlinks } from "../memory/entry"
import { isBrokenLink, knownNames } from "../memory/health"
import type { AutoEntry } from "../memory/types"
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
  if (!item) return <text fg={DIM} wrapMode="none">No item selected</text>
  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <text wrapMode="none">
        <span fg={ACCENT}>{item.name}</span>
        <span fg={DIM}>{`  ${HARNESS_LABELS[item.harness]} · ${item.scope}`}</span>
      </text>
      {detail && <DetailBody detail={detail} />}
      <Field label="file" value={tildePath(item.path, home)} />
      {item.key && <Field label="key" value={item.key} />}
      {item.readOnly && <Field label="read-only" value={item.readOnly} />}
      {[...(item.warnings ?? []), ...checksOf(item, detail)].map((warning) => <text key={warning} fg={theme.warn} wrapMode="none">{`! ${warning}`}</text>)}
    </box>
  )
}

// Auto memory entry: name, type, index line and start load on one line, then its links out and in.
function EntryDetail({ entry, siblings, home }: { entry: AutoEntry; siblings: AutoEntry[]; home: string }) {
  const known = knownNames(siblings)
  const from = backlinks(siblings, entry)
  const loadedAtStart = entry.indexLine !== null && !entry.pastLoadLimit
  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <text wrapMode="none">
        <span fg={ACCENT}>{entry.title}</span>
        <span fg={DIM}>{` · ${entry.type ?? "-"} · ${indexText(entry)} · loaded at start `}</span>
        <span fg={loadedAtStart ? theme.ok : theme.err}>{loadedAtStart ? "✓" : "✗"}</span>
      </text>
      {entry.description !== "" && <text wrapMode="none">{entry.description}</text>}
      <text wrapMode="none">
        <span fg={DIM}>{"Links out: "}</span>
        {entry.links.length === 0 ? <span fg={DIM}>nothing</span> : null}
        {entry.links.map((link) => (
          <span key={link} fg={isBrokenLink(known, link) ? theme.err : ACCENT}>{`[[${link}]] `}</span>
        ))}
      </text>
      <text fg={DIM} wrapMode="none">{`Linked from: ${from.length ? from.map((e) => e.name).join(", ") : "nothing"}`}</text>
      <Field label="file" value={tildePath(entry.path, home)} />
    </box>
  )
}

const indexText = (entry: AutoEntry) => (entry.indexLine === null ? "not in index" : `index line ${entry.indexLine}`)

// Skill checks per harness that loads or can turn on the skill.
function checksOf(item: Item, detail: ItemDetail | null): string[] {
  if (item.kind !== "skill" || detail?.type !== "text") return []
  const readers = [...item.loadedBy, ...(item.offIn ?? [])]
  return readers.flatMap((id) => skillChecks(id, basename(item.path), detail.text).map((check) => `${HARNESS_LABELS[id]}: ${check}`))
}

function DetailBody({ detail }: { detail: ItemDetail }) {
  if (detail.type === "text") return <text>{detail.text}</text>
  if (detail.type === "mcp") return <McpFields server={detail.server} />
  const { plugin } = detail
  return (
    <box flexDirection="column">
      <Field label="state" value={plugin.enabled ? "on" : "off"} />
      {plugin.version && <Field label="version" value={plugin.version} />}
      {plugin.source && <Field label="source" value={plugin.source} />}
      <text fg={DIM}>{`space ${plugin.enabled ? "disable" : "enable"}  U update  x uninstall`}</text>
    </box>
  )
}

function McpFields({ server }: { server: McpServer }) {
  const command = [server.command, ...(server.args ?? [])].join(" ")
  return (
    <box flexDirection="column">
      <Field label="type" value={server.transport} />
      {server.url && <Field label="url" value={server.url} />}
      {server.command && <Field label="command" value={command} />}
      {Object.entries(server.env ?? {}).map(([name, value]) => (
        <Field key={name} label="env" value={`${name}=${maskSecret(value)}`} />
      ))}
      {Object.entries(server.headers ?? {}).map(([name, value]) => (
        <Field key={name} label="header" value={`${name}: ${maskSecret(value)}`} />
      ))}
      {!server.enabled && <Field label="state" value="off" />}
    </box>
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
