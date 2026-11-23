import { useKeyboard } from "@opentui/react"
import { createTwoFilesPatch } from "diff"
import { useRef, useState } from "react"
import { applyPlan, StaleFileError } from "../core/apply"
import type { FileEdit, WritePlan } from "../core/model"
import { tildePath } from "./ItemList"
import { ACCENT, DIM } from "./theme"

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
    applyPlan(plan, { backupRoot }).then(
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
    <box flexDirection="column" paddingLeft={1}>
      <text>
        <span fg={ACCENT}>{`${changeCount(plan)} changes`}</span>
        <span fg={DIM}>  nothing is written until you press enter</span>
        {secrets.length > 0 && <span fg={DIM}>{`  r ${revealed ? "hides" : "shows"} secrets`}</span>}
      </text>
      {plan.edits.map((edit) => <EditDiff key={edit.path} edit={edit} home={home} mask={mask} />)}
      {plan.moves.map(({ from, to }) => <Line key={from} label="move" text={`${path(from)} → ${path(to)}`} />)}
      {plan.copies.map(({ from, to }) => <Line key={from} label="copy" text={`${path(from)} → ${path(to)}`} />)}
      {plan.removals.map((removal) => <Line key={removal} label="moved to backup" text={path(removal)} />)}
      {plan.commands.map(({ argv }) => <Line key={argv.join(" ")} label="run command" text={mask(argv.join(" "))} />)}
      {plan.notices.map((notice) => <Line key={notice} label="note" text={notice} />)}
      <Line label="Backup ›" text={`${path(backupRoot)}/…`} />
      {error && <text fg="#ff5f5f">{error}</text>}
    </box>
  )
}

function failureMessage(failure: Error): string {
  if (failure instanceof StaleFileError) return `${failure.path} changed since it was read. Reload and try again.`
  return failure.message
}

function changeCount(plan: WritePlan): number {
  return plan.edits.length + plan.moves.length + plan.copies.length + plan.removals.length + plan.commands.length
}

// Masks a secret only where it stands as a quoted value, so short values such as "1" elsewhere stay readable.
function hideSecrets(text: string, secrets: string[]): string {
  const masked = secrets.filter((secret) => secret.length >= 4)
  return masked.reduce((result, secret) => result.replaceAll(`"${secret}"`, '"••••••••"'), text)
}

function EditDiff({ edit, home, mask }: { edit: FileEdit; home: string; mask: (text: string) => string }) {
  const label = edit.before === null ? "new file" : edit.after === null ? "delete" : "edit"
  const patch = createTwoFilesPatch(edit.path, edit.path, edit.before ?? "", edit.after ?? "")
  return (
    <box flexDirection="column">
      <Line label={label} text={tildePath(edit.path, home)} />
      <diff diff={mask(patch)} view="unified" showLineNumbers={false} />
    </box>
  )
}

function Line({ label, text }: { label: string; text: string }) {
  return (
    <text>
      <span fg={DIM}>{`${label}  `}</span>
      {text}
    </text>
  )
}
