import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { HARNESS_LABELS } from "../core/model"
import { pad } from "../memory/format"
import { Dialog } from "./Dialog"
import { countOf, type Marketplace } from "./flows"
import { OptionRow, useCursor } from "./Prompt"
import { DIM } from "./theme"

interface MarketplacesProps {
  marketplaces: Marketplace[]
  onAdd: () => void
  onRemove: (marketplace: Marketplace) => void
  onBack: () => void
}

const TABLE_WIDTH = 96
const HEADER = ` ${pad("NAME", 14)}${pad("HARNESS", 14)}${pad("SOURCE", 40)}INSTALLED`

export function Marketplaces({ marketplaces, onAdd, onRemove, onBack }: MarketplacesProps) {
  const cursor = useCursor(marketplaces.length)
  const { width } = useTerminalDimensions()
  useKeyboard((key) => {
    if (key.name === "escape") onBack()
    if (key.name === "a") onAdd()
    if (key.name === "up" || key.name === "down") cursor.move(key.name === "up" ? -1 : 1)
    const marketplace = marketplaces[cursor.now.current]
    if (key.name === "d" && marketplace) onRemove(marketplace)
  })
  return (
    <Dialog title="Marketplaces" width={Math.min(TABLE_WIDTH, width - 4)}>
      <text> </text>
      {marketplaces.length ? <text fg={DIM}>{HEADER}</text> : <text fg={DIM}>No marketplaces. Press a to add one.</text>}
      {marketplaces.map((marketplace, index) => (
        <OptionRow key={`${marketplace.harness}:${marketplace.name}`} selected={index === cursor.index}>
          {` ${pad(marketplace.name, 14)}${pad(HARNESS_LABELS[marketplace.harness], 14)}${pad(marketplace.source, 40)}${countOf(marketplace.installed, "plugin")}`}
        </OptionRow>
      ))}
      <text> </text>
    </Dialog>
  )
}
