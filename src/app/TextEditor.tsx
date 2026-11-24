import type { TextareaRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useRef, useState } from "react"
import { ACCENT, theme } from "./theme"

interface TextEditorProps {
  title: string
  label?: string // "Harness · scope" of the file, when known
  initialText: string
  onSave: (text: string) => void
  onCancel: () => void
}

interface EditorStatus {
  text: string
  line: number
  column: number
}

// ctrl+s hands the text on for review; esc discards it.
export function TextEditor({ title, label, initialText, onSave, onCancel }: TextEditorProps) {
  const textarea = useRef<TextareaRenderable>(null)
  const [status, setStatus] = useState<EditorStatus>({ text: initialText, line: 0, column: 0 })
  useKeyboard((key) => {
    if (key.name === "escape") onCancel()
    else if (key.ctrl && key.name === "s") onSave(textarea.current?.plainText ?? initialText)
  })
  const update = () => {
    const editor = textarea.current
    if (editor) setStatus({ text: editor.plainText, line: editor.logicalCursor.row, column: editor.logicalCursor.col })
  }
  const modified = status.text !== initialText
  const lineCount = status.text.split("\n").length
  return (
    <box flexDirection="column" flexGrow={1} border borderStyle="rounded" borderColor={theme.borderActive} title={` ${title} `} titleColor={ACCENT} bottomTitle={` line ${status.line + 1}, col ${status.column + 1} · ${lineCount} lines `} bottomTitleAlignment="right">
      <text alignSelf="flex-end">
        <span fg={theme.dim}>{label ?? ""}</span>
        <span fg={theme.warn}>{modified ? `${label ? " · " : ""}● modified` : ""}</span>
      </text>
      <line-number fg={theme.faint} minWidth={4} paddingRight={2} flexGrow={1}>
        <textarea ref={textarea} initialValue={initialText} focused flexGrow={1} onContentChange={update} onCursorChange={update} />
      </line-number>
    </box>
  )
}
