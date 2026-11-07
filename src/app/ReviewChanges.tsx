import { useKeyboard } from "@opentui/react"
import { createTwoFilesPatch } from "diff"
import { useState } from "react"
import { applyPlan, StaleFileError } from "../core/apply"
import type { FileEdit, WritePlan } from "../core/model"
import { ACCENT, DIM, tildePath } from "./ItemList"

interface ReviewChangesProps {
  plan: WritePlan
  backupRoot: string
  home: string
  onApplied: (message: string) => void
  onBack: () => void
}

// Nothing is written until enter is pressed on this screen.
export function ReviewChanges({ plan, backupRoot, home, onApplied, onBack }: ReviewChangesProps) {
  const [error, setError] = useState("")
  useKeyboard((key) => {
    if (key.name === "escape") onBack()
    if (key.name !== "return") return
    applyPlan(plan, { backupRoot }).then(
      ({ backupDir, notices }) => onApplied([`Saved. Backup › ${tildePath(backupDir, home)}`, ...notices].join("  ")),
      (failure: Error) => setError(failureMessage(failure)),
    )
  })
  const path = (value: string) => tildePath(value, home)
  return (
    <box flexDirection="column" paddingLeft={1}>
      <text>
        <span fg={ACCENT}>{`${changeCount(plan)} changes`}</span>
        <span fg={DIM}>  nothing is written until you press enter</span>
      </text>
      {plan.edits.map((edit) => <EditDiff key={edit.path} edit={edit} home={home} />)}
      {plan.moves.map(({ from, to }) => <Line key={from} label="move" text={`${path(from)} → ${path(to)}`} />)}
      {plan.copies.map(({ from, to }) => <Line key={from} label="copy" text={`${path(from)} → ${path(to)}`} />)}
      {plan.removals.map((removal) => <Line key={removal} label="moved to backup" text={path(removal)} />)}
      {plan.commands.map(({ argv }) => <Line key={argv.join(" ")} label="run command" text={argv.join(" ")} />)}
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

function EditDiff({ edit, home }: { edit: FileEdit; home: string }) {
  const label = edit.before === null ? "new file" : edit.after === null ? "delete" : "edit"
  const patch = createTwoFilesPatch(edit.path, edit.path, edit.before ?? "", edit.after ?? "")
  return (
    <box flexDirection="column">
      <Line label={label} text={tildePath(edit.path, home)} />
      <diff diff={patch} view="unified" showLineNumbers={false} />
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
