// Klaviyo theme tokens, copied from claude-memory-desk src/theme.ts.
export const theme = {
  bg: "#0d1117",
  raised: "#161b22",
  border: "#30363d",
  borderActive: "#2dd4a7",
  text: "#e6edf3",
  dim: "#8b949e",
  faint: "#565f6b",
  accent: "#2dd4a7",
  accent2: "#7aa2f7",
  group: "#e0af68",
  ok: "#9ece6a",
  warn: "#e0af68",
  err: "#f7768e",
  selBg: "#1b3a33",
  selFg: "#ffffff",
} as const

export const ACCENT = theme.accent
export const DIM = theme.dim
export const SELECTED_BG = theme.selBg
