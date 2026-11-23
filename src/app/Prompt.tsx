import { useKeyboard } from "@opentui/react"
import { useState } from "react"
import { ACCENT, DIM } from "./theme"

// A select when options are given, else a text input.
export interface PromptStep {
  label: string
  options?: { name: string; description: string; value: string }[]
}

interface PromptProps {
  title: string
  nextStep: (answers: string[]) => PromptStep | null // null = done
  onDone: (answers: string[]) => void
  onCancel: () => void
}

// Asks one step at a time; each step can depend on the answers before it.
export function Prompt({ title, nextStep, onDone, onCancel }: PromptProps) {
  const [answers, setAnswers] = useState<string[]>([])
  useKeyboard((key) => key.name === "escape" && onCancel())
  const step = nextStep(answers)
  const answer = (value: string) => {
    const next = [...answers, value]
    if (nextStep(next)) setAnswers(next)
    else onDone(next)
  }
  if (!step) return null
  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1}>
      <text fg={ACCENT}>{title}</text>
      <text fg={DIM}>{step.label}</text>
      {step.options ? (
        <select key={answers.length} options={step.options} focused flexGrow={1} onSelect={(_, option) => option && answer(option.value)} />
      ) : (
        // The React input passes the text; the type also allows the textarea's SubmitEvent.
        <input key={answers.length} focused onSubmit={(value) => typeof value === "string" && value.trim() && answer(value.trim())} />
      )}
    </box>
  )
}
