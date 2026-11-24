import { useKeyboard } from "@opentui/react"
import { useState } from "react"
import { HARNESS_LABELS } from "../core/model"
import type { Marketplace } from "./flows"
import { ACCENT, DIM } from "./theme"

interface MarketplacesProps {
  marketplaces: Marketplace[]
  onAdd: () => void
  onRemove: (marketplace: Marketplace) => void
  onBack: () => void
}

export function Marketplaces({ marketplaces, onAdd, onRemove, onBack }: MarketplacesProps) {
  const [selected, setSelected] = useState(0)
  useKeyboard((key) => {
    if (key.name === "escape") onBack()
    if (key.name === "a") onAdd()
    const marketplace = marketplaces[selected]
    if (key.name === "d" && marketplace) onRemove(marketplace)
  })
  const options = marketplaces.map((marketplace) => ({ name: marketplace.name, description: `${HARNESS_LABELS[marketplace.harness]} · ${marketplace.source}`, value: marketplace.name }))
  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1}>
      <text fg={ACCENT}>Marketplaces</text>
      {options.length ? <select options={options} focused flexGrow={1} onChange={(index) => setSelected(index)} /> : <text fg={DIM}>No marketplaces</text>}
    </box>
  )
}
