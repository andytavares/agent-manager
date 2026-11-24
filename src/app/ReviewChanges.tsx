import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { createTwoFilesPatch } from "diff"
import { useRef, useState, type ReactNode } from "react"
import { applyWithUndo } from "../core/undo"
import { StaleFileError } from "../core/apply"
import type { FileEdit, WritePlan } from "../core/model"
import { tildePath } from "./ItemList"
import { ACCENT, DIM, theme } from "./theme"

interface ReviewChangesProps {
  plan: WritePlan
  secrets: string[] // shown as "••••••••" until r is pressed
  backupRoot: string
  home: string
  onApplied: (message: string) => void
  onBack: () => void
}

// Nothing is written until enter is pressed on this screen.
export function ReviewChanges({ plan, secrets, backupRoot, home, onApplied, onBack }: ReviewChangesProps) {
  const [error, setError] = useState("")
  const [revealed, setRevealed] = useState(false)
  const applying = useRef(false) // a second enter while the first apply runs must not run the plan again
  useKeyboard((key) => {
    if (key.name === "escape" && !applying.current) onBack()
    if (key.name === "r") setRevealed(!revealed)
    if (key.name !== "return" || applying.current) return
    applying.current = true
    applyWithUndo(plan, { backupRoot }).then(
      ({ backupDir, notices }) => onApplied([`Saved. Backup › ${tildePath(backupDir, home)}`, ...notices].join("  ")),
      (failure: Error) => {
        applying.current = false
        setError(failureMessage(failure))
      },
    )
  })
  const path = (value: string) => tildePath(value, home)
  const mask = (text: string) => (revealed ? text : hideSecrets(text, secrets))
  return (
    <ScrollPanel>
      <text><b>{planSummary(plan)}</b></text>
      <Explanation plan={plan} backup={`${path(backupRoot)}/…`} secretsToggle={secrets.length > 0 ? (revealed ? "hides" : "shows") : undefined} />
      {plan.edits.map((edit) => <EditDiff key={edit.path} edit={edit} home={home} mask={mask} />)}
      <OtherChanges plan={plan} path={path} mask={mask} />
      {error && <text fg={theme.err}>{error}</text>}
    </ScrollPanel>
  )
}

// The content keeps its full height (flexShrink 0) and the box scrolls with the arrow keys.
function ScrollPanel({ children }: { children: ReactNode }) {
  const scroll = useRef<ScrollBoxRenderable>(null)
  useKeyboard((key) => {
    if (key.name === "down") scroll.current?.scrollBy(1)
    if (key.name === "up") scroll.current?.scrollBy(-1)
  })
  return (
    <box border borderStyle="rounded" borderColor={theme.borderActive} title=" Review changes " flexDirection="column" flexGrow={1} paddingX={1}>
      <scrollbox ref={scroll} flexGrow={1} flexShrink={1} scrollY>
        <box flexDirection="column" flexShrink={0}>
          {children}
        </box>
      </scrollbox>
    </box>
  )
}

function failureMessage(failure: Error): string {
  if (failure instanceof StaleFileError) return `${failure.path} changed since it was read. Reload and try again.`
  return failure.message
}

function planSummary(plan: WritePlan): string {
  const lines = plan.edits.map(editPatch).flatMap((patch) => patch.split("\n"))
  const added = lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length
  const removed = lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length
  const changed = Math.min(added, removed)
  const parts = [
    counted(plan.edits.length, "file edited", "files edited"),
    counted(plan.moves.length, "file moved", "files moved"),
    counted(plan.copies.length, "file copied", "files copied"),
    counted(plan.removals.length, "file removed", "files removed"),
    counted(changed, "line changed", "lines changed"),
    counted(added - changed, "line added", "lines added"),
    counted(removed - changed, "line removed", "lines removed"),
    counted(plan.commands.length, "command", "commands"),
  ]
  return parts.filter((part) => part !== "").join(" · ")
}

function counted(count: number, one: string, many: string): string {
  if (count === 0) return ""
  return `${count} ${count === 1 ? one : many}`
}

function editPatch(edit: FileEdit): string {
  return createTwoFilesPatch(edit.path, edit.path, edit.before ?? "", edit.after ?? "", undefined, undefined, { context: 3 })
}

// Masks a secret only where it stands as a quoted value, so short values such as "1" elsewhere stay readable.
function hideSecrets(text: string, secrets: string[]): string {
  const masked = secrets.filter((secret) => secret.length >= 4)
  return masked.reduce((result, secret) => result.replaceAll(`"${secret}"`, '"••••••••"'), text)
}

function EditDiff({ edit, home, mask }: { edit: FileEdit; home: string; mask: (text: string) => string }) {
  const label = edit.before === null ? "new file" : edit.after === null ? "delete" : "edit"
  return (
    <box flexDirection="column" marginTop={1}>
      <Line label={label} text={tildePath(edit.path, home)} />
      <diff
        diff={mask(editPatch(edit))}
        view="unified"
        showLineNumbers
        addedBg={theme.addBg}
        removedBg={theme.delBg}
        addedSignColor={theme.ok}
        removedSignColor={theme.err}
      />
    </box>
  )
}

function OtherChanges({ plan, path, mask }: { plan: WritePlan; path: (value: string) => string; mask: (text: string) => string }) {
  return (
    <box flexDirection="column" marginTop={1}>
      {plan.moves.map(({ from, to }) => <Line key={from} label="move" text={`${path(from)} → ${path(to)}`} />)}
      {plan.copies.map(({ from, to }) => <Line key={from} label="copy" text={`${path(from)} → ${path(to)}`} />)}
      {plan.removals.map((removal) => <Line key={removal} label="moved to backup" text={path(removal)} />)}
      {plan.commands.map(({ argv }) => <Line key={argv.join(" ")} label="run command" text={mask(argv.join(" "))} />)}
      {plan.notices.map((notice) => <Line key={notice} label="note" text={notice} />)}
    </box>
  )
}

function Explanation({ plan, backup, secretsToggle }: { plan: WritePlan; backup: string; secretsToggle?: "shows" | "hides" }) {
  return (
    <text fg={DIM}>
      Nothing is written until you press <Key name="⏎" />{`. Backup: ${backup}. `}
      {plan.commands.length > 0 ? <><Key name="u" /> undoes the file changes. Commands that run are not undone.</> : <>Undo with <Key name="u" />, even after you quit.</>}
      {secretsToggle && <>{"  "}<Key name="r" />{` ${secretsToggle} secrets`}</>}
    </text>
  )
}

function Key({ name }: { name: string }) {
  return <span fg={ACCENT}><b>{name}</b></span>
}

function Line({ label, text }: { label: string; text: string }) {
  return (
    <text>
      <span bg={theme.border}>{` ${label} `}</span>
      {` ${text}`}
    </text>
  )
}
