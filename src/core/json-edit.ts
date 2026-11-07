import { applyEdits, modify, type JSONPath } from "jsonc-parser"

const FORMAT = { formattingOptions: { tabSize: 2, insertSpaces: true } }

// Sets one key in JSON or JSONC text; value undefined removes it. Comments and other formatting stay.
export const setJsonc = (text: string, path: JSONPath, value: unknown): string => applyEdits(text, modify(text, path, value, FORMAT))
