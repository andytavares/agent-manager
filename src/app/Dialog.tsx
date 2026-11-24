import type { ReactNode } from "react"
import { ACCENT, theme } from "./theme"

interface DialogProps {
  title: string
  right?: string // a label at the right end of the bottom border, such as a step count
  width: number
  children: ReactNode
}

// A frame sized to its content, centered over the screen body.
export function Dialog({ title, right, width, children }: DialogProps) {
  return (
    <box flexGrow={1} alignItems="center" justifyContent="center">
      <box
        width={width}
        flexDirection="column"
        border
        borderStyle="rounded"
        borderColor={theme.border}
        backgroundColor={theme.raised}
        title={` ${title} `}
        titleColor={ACCENT}
        bottomTitle={right ? ` ${right} ` : undefined}
        bottomTitleAlignment="right"
        paddingLeft={1}
        paddingRight={1}
      >
        {children}
      </box>
    </box>
  )
}
