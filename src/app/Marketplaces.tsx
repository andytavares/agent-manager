import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { HARNESS_LABELS } from "../core/model"
import { CellHeader, Cells, columnWidths, SelectableRow, tableDialogWidth, type Cell, type Column } from "./CellRow"
import { Dialog } from "./Dialog"
import { countOf, type Marketplace } from "./flows"
import { useCursor } from "./Prompt"
import { DIM } from "./theme"

interface MarketplacesProps {
  marketplaces: Marketplace[]
  onAdd: () => void
  onRemove: (marketplace: Marketplace) => void
  onBack: () => void
}

const COLUMNS: Column[] = [
  { header: "NAME", give: "name" },
  { header: "HARNESS", give: "fixed" },
  { header: "SOURCE", give: "path" },
  { header: "INSTALLED", give: "fixed" },
]

const EMPTY_NOTE = "No marketplaces. Press a to add one."

const marketplaceCells = (marketplace: Marketplace): Cell[] => [[marketplace.name], [HARNESS_LABELS[marketplace.harness]], [marketplace.source], [countOf(marketplace.installed, "plugin")]]

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
  const cells = marketplaces.map(marketplaceCells)
  const widths = columnWidths(COLUMNS, cells)
  return (
    <Dialog title="Marketplaces" width={Math.min(width - 4, Math.max(EMPTY_NOTE.length + 4, tableDialogWidth(widths)))}>
      <text> </text>
      {marketplaces.length ? <CellHeader columns={COLUMNS} widths={widths} /> : <text fg={DIM}>{EMPTY_NOTE}</text>}
      {marketplaces.map((marketplace, index) => (
        <SelectableRow key={`${marketplace.harness}:${marketplace.name}`} selected={index === cursor.index}>
          <Cells cells={cells[index]!} columns={COLUMNS} widths={widths} />
        </SelectableRow>
      ))}
      <text> </text>
    </Dialog>
  )
}
