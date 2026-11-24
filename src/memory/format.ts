export const truncate = (text: string, max: number) =>
  max <= 0 ? "" : text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`

export const pad = (text: string, width: number) => truncate(text, width).padEnd(width)

export const bar = (used: number, max: number, width = 20): [string, string] => {
  const filled = Math.min(width, Math.max(1, Math.round((used / max) * width)))
  return ["█".repeat(filled), "░".repeat(width - filled)]
}

// Cuts a path from the middle, so the start and the file name stay readable.
export function shortPath(path: string, max: number): string {
  if (path.length <= max) return path
  const parts = path.split("/")
  const head = parts.slice(0, 2).join("/")
  let tail = ""
  for (const part of parts.slice(2).reverse()) {
    const next = tail ? `${part}/${tail}` : part
    if (`${head}/…/${next}`.length > max) break
    tail = next
  }
  return tail ? `${head}/…/${tail}` : truncate(path, max)
}
