import { applyEdits, findNodeAtLocation, modify, parseTree, type JSONPath } from "jsonc-parser"

const FORMAT = { formattingOptions: { tabSize: 2, insertSpaces: true } }

// Sets one key in JSON or JSONC text; value undefined removes it. Comments and other formatting stay.
export function setJsonc(text: string, path: JSONPath, value: unknown): string {
  if (value === undefined && typeof path.at(-1) === "number") return removeArrayElement(text, path)
  return applyEdits(text, modify(text, path, value, FORMAT))
}

// jsonc-parser 3.3.1 corrupts a one-line array when it removes the last element, so cut it out by offset.
function removeArrayElement(text: string, path: JSONPath): string {
  const tree = parseTree(text)
  const node = tree && findNodeAtLocation(tree, path)
  if (!node) return text
  const siblings = node.parent!.children!
  const previous = siblings[siblings.indexOf(node) - 1]
  const start = previous ? previous.offset + previous.length : node.offset
  const end = previous ? node.offset + node.length : (siblings[1]?.offset ?? node.offset + node.length)
  return text.slice(0, start) + text.slice(end)
}
