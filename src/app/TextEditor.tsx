import type { TextareaRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useRef } from "react"
import { ACCENT } from "./ItemList"

interface TextEditorProps {
  title: string
  initialText: string
  onSave: (text: string) => void
  onCancel: () => void
}

// ctrl+s hands the text on for review; esc discards it.
export function TextEditor({ title, initialText, onSave, onCancel }: TextEditorProps) {
  const textarea = useRef<TextareaRenderable>(null)
  useKeyboard((key) => {
    if (key.name === "escape") onCancel()
    else if (key.ctrl && key.name === "s") onSave(textarea.current?.plainText ?? initialText)
  })
  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1}>
      <text fg={ACCENT}>{title}</text>
      <textarea ref={textarea} initialValue={initialText} focused flexGrow={1} />
    </box>
  )
}
