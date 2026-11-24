import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useRef, useState } from "react"
import { pad } from "../memory/format"
import { Cells, columnWidths, SelectableRow, type Cell, type Column } from "./CellRow"
import { Dialog } from "./Dialog"
import { ACCENT, DIM, theme } from "./theme"

export interface PromptOption {
  name: string
  description: string
  value: string
}

// A list of options when options are given, else a text input.
export interface PromptStep {
  label: string
  hint?: string
  steps?: string[] // the name of every step of the wizard, for "Step n of N"
  options?: PromptOption[]
}

interface PromptProps {
  title: string
  nextStep: (answers: string[]) => PromptStep | null // null = done
  onDone: (answers: string[]) => void
  onCancel: () => void
}

const WIZARD_WIDTH = 74
const ANSWER_LABEL_WIDTH = 13

// Asks one step at a time; each step can depend on the answers before it.
export function Prompt({ title, nextStep, onDone, onCancel }: PromptProps) {
  const [answers, setAnswers] = useState<string[]>([])
  const { width } = useTerminalDimensions()
  useKeyboard((key) => key.name === "escape" && onCancel())
  const step = nextStep(answers)
  const answer = (value: string) => {
    const next = [...answers, value]
    if (nextStep(next)) setAnswers(next)
    else onDone(next)
  }
  if (!step) return null
  return (
    <Dialog title={title} width={Math.min(WIZARD_WIDTH, width - 4)}>
      {step.steps && <StepTrail steps={step.steps} current={answers.length} />}
      <text> </text>
      <AnswerLines answers={answers} steps={step.steps} nextStep={nextStep} />
      <text>
        <strong>{step.label}</strong>
      </text>
      {step.hint && <text fg={DIM}>{step.hint}</text>}
      <text> </text>
      {step.options ? (
        <OptionList key={answers.length} options={step.options} onChoose={answer} />
      ) : (
        // The React input passes the text; the type also allows the textarea's SubmitEvent.
        <input key={answers.length} focused backgroundColor={theme.bg} focusedBackgroundColor={theme.selBg} onSubmit={(value) => typeof value === "string" && value.trim() && answer(value.trim())} />
      )}
    </Dialog>
  )
}

// "Step n of N", then each step name: ✓ done, ● current, ○ next.
function StepTrail({ steps, current }: { steps: string[]; current: number }) {
  const mark = (index: number) => (index < current ? ["✓", DIM] : index === current ? ["●", ACCENT] : ["○", DIM])
  return (
    <>
      <text fg={DIM}>{`Step ${current + 1} of ${steps.length}`}</text>
      <text>
        {steps.map((name, index) => {
          const [symbol, color] = mark(index)
          return <span key={name} fg={color}>{`${index ? "  " : ""}${symbol} ${name}`}</span>
        })}
      </text>
    </>
  )
}

interface AnswerLinesProps {
  answers: string[]
  steps?: string[]
  nextStep: PromptProps["nextStep"]
}

// Each earlier answer as "label  value"; an option answer shows the option's name.
function AnswerLines({ answers, steps, nextStep }: AnswerLinesProps) {
  if (!answers.length) return null
  const lines = answers.map((value, index) => ({ label: steps?.[index] ?? "", shown: optionName(nextStep(answers.slice(0, index)), value) }))
  return (
    <>
      {lines.map(({ label, shown }, index) => (
        <text key={index}>
          <span fg={DIM}>{pad(label, ANSWER_LABEL_WIDTH)}</span>
          {shown}
        </text>
      ))}
      <text> </text>
    </>
  )
}

function optionName(step: PromptStep | null, value: string): string {
  return step?.options?.find((option) => option.value === value)?.name ?? value
}

const OPTION_COLUMNS: Column[] = [
  { header: "", give: "name" },
  { header: "", give: "note" },
]

function OptionList({ options, onChoose }: { options: PromptOption[]; onChoose: (value: string) => void }) {
  const cursor = useCursor(options.length)
  useKeyboard((key) => {
    if (key.name === "up" || key.name === "down") cursor.move(key.name === "up" ? -1 : 1)
    const chosen = options[cursor.now.current]
    if (key.name === "return" && chosen) onChoose(chosen.value)
  })
  if (options.length === 0) return <text fg={DIM}>No choices left. Press esc to go back.</text>
  const cells = options.map((option): Cell[] => [[option.name], [option.description, DIM]])
  const widths = columnWidths(OPTION_COLUMNS, cells)
  return options.map((option, index) => (
    <SelectableRow key={option.value} selected={index === cursor.index}>
      <Cells cells={cells[index]!} columns={OPTION_COLUMNS} widths={widths} />
    </SelectableRow>
  ))
}

// A ref next to the state, because a key can arrive before the previous key's render.
export function useCursor(count: number, start = 0) {
  const now = useRef(start)
  const [index, setIndex] = useState(start)
  const move = (step: number) => {
    now.current = Math.max(0, Math.min(count - 1, now.current + step))
    setIndex(now.current)
  }
  return { index, now, move }
}
