import { ACCENT, DIM, theme } from "./theme"

export type KeyHint = [key: string, label: string]

const GROUP_GAP = "  │  "
const HINT_GAP = "  "

const hintsWidth = (hints: KeyHint[]) => hints.map(([key, label]) => `${key} ${label}`).join(HINT_GAP).length

function totalWidth(groups: KeyHint[][]): number {
  return groups.reduce((sum, hints) => sum + hintsWidth(hints), 0) + GROUP_GAP.length * Math.max(0, groups.length - 1)
}

// Drops hints from the end of the screen's own groups until the bar fits; the last group (the shell keys) always stays.
export function fitHints(groups: KeyHint[][], width: number): KeyHint[][] {
  const shell = groups.at(-1) ?? []
  const own = groups.slice(0, -1).map((hints) => [...hints])
  while (own.length && totalWidth([...own, shell]) > width) {
    own.at(-1)!.pop()
    if (own.at(-1)!.length === 0) own.pop()
  }
  return [...own, shell]
}

interface KeyBarProps {
  groups: KeyHint[][]
  width: number
  right?: string // a short status, such as the row position
}

export function KeyBar({ groups, width, right = "" }: KeyBarProps) {
  const fitted = fitHints(groups, width - right.length - 3)
  const used = totalWidth(fitted)
  return (
    <text flexShrink={0} wrapMode="none">
      {" "}
      {fitted.map((hints, index) => (
        <span key={index}>
          {index > 0 && <span fg={theme.faint}>{GROUP_GAP}</span>}
          {hints.map(([key, label], at) => (
            <span key={key}>
              {at > 0 && HINT_GAP}
              <span fg={ACCENT}><b>{key}</b></span>
              <span fg={DIM}>{` ${label}`}</span>
            </span>
          ))}
        </span>
      ))}
      <span fg={DIM}>{right && `${" ".repeat(Math.max(1, width - used - right.length - 2))}${right}`}</span>
    </text>
  )
}
