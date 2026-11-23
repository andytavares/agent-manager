export const truncate = (text: string, max: number) =>
  max <= 0 ? "" : text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`

export const pad = (text: string, width: number) => truncate(text, width).padEnd(width)

export const bar = (used: number, max: number, width = 20): [string, string] => {
  const filled = Math.min(width, Math.max(1, Math.round((used / max) * width)))
  return ["█".repeat(filled), "░".repeat(width - filled)]
}
