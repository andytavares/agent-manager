import { useEffect, useState } from "react"
import { HARNESS_LABELS, type HarnessAdapter, type Item, type ItemDetail, type McpServer } from "../core/model"
import { maskSecret } from "../core/registry"
import { ACCENT, DIM, tildePath } from "./ItemList"

interface DetailPaneProps {
  item: Item | undefined
  adapter: HarnessAdapter | undefined // the adapter of item.harness
  home: string
}

export function DetailPane({ item, adapter, home }: DetailPaneProps) {
  const [detail, setDetail] = useState<ItemDetail | null>(null)
  useEffect(() => {
    if (!item || !adapter) return
    let live = true
    setDetail(null)
    adapter.read(item).then(
      (read) => live && setDetail(read),
      (error: Error) => live && setDetail({ type: "text", text: `Cannot read: ${error.message}` }),
    )
    return () => {
      live = false
    }
  }, [item, adapter])

  if (!item) return <text fg={DIM}>No item</text>
  return (
    <box flexDirection="column" paddingLeft={1}>
      <text fg={ACCENT}>{item.name}</text>
      <text fg={DIM}>{`${HARNESS_LABELS[item.harness]} · ${item.scope}`}</text>
      <text> </text>
      {detail && <DetailBody detail={detail} />}
      <text> </text>
      <Field label="file" value={tildePath(item.path, home)} />
      {item.key && <Field label="key" value={item.key} />}
      {item.readOnly && <Field label="read-only" value={item.readOnly} />}
      {item.warnings?.map((warning) => <text key={warning} fg="#ffaf00">{`! ${warning}`}</text>)}
    </box>
  )
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
    <text>
      <span fg={DIM}>{label.padEnd(10)}</span>
      {value}
    </text>
  )
}
