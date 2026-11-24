import type { ScrollBoxRenderable } from "@opentui/core"
import { useEffect, useRef, type ReactNode } from "react"

export interface ScrollRow {
  id: string // unique among the rows; the scroll box finds the selected row by it
  node: ReactNode
}

interface ScrollListProps {
  rows: ScrollRow[]
  selectedId?: string
}

// Rows keep their full height (flexShrink 0) and the box scrolls, so a long list never drops rows.
export function ScrollList({ rows, selectedId }: ScrollListProps) {
  const box = useRef<ScrollBoxRenderable>(null)
  useEffect(() => {
    if (selectedId) box.current?.scrollChildIntoView(selectedId)
  }, [selectedId, rows.length])
  return (
    <scrollbox ref={box} flexGrow={1} flexShrink={1} scrollY>
      {rows.map((row) => (
        <box key={row.id} id={row.id} flexShrink={0}>
          {row.node}
        </box>
      ))}
    </scrollbox>
  )
}
