import type { AutoEntry } from "./types"

const isBoundary = (ch: string | undefined) => ch === undefined || ch === " " || ch === "-" || ch === "_" || ch === "/"

interface Run { score: number; matched: number; span: number }

function scoreRun(token: string, text: string, start: number): Run {
  let score = 0
  let matched = 0
  let prev = -2
  for (let i = start; i < text.length && matched < token.length; i++) {
    if (text[i] !== token[matched]) continue
    score += 1 + (i === prev + 1 ? 3 : 0) + (isBoundary(text[i - 1]) ? 4 : 0)
    prev = i
    matched++
  }
  return { score, matched, span: prev - start + 1 }
}

// Starts on a word boundary and stays tight, so short tokens don't match scattered letters.
function subsequenceScore(token: string, text: string): number | null {
  const maxSpan = token.length * 3 + 4
  let best: number | null = null
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== token[0] || !isBoundary(text[start - 1])) continue
    const run = scoreRun(token, text, start)
    if (run.matched < token.length) break
    if (run.span <= maxSpan && (best === null || run.score > best)) best = run.score
  }
  return best
}

function substringScore(token: string, text: string, idx: number): number {
  let score = 40 + token.length * 4
  if (isBoundary(text[idx - 1])) score += 20
  if (idx === 0) score += 15
  if (token.length === text.length) score += 30
  return score
}

function matchToken(token: string, entry: AutoEntry): number | null {
  const text = `${entry.title} ${entry.name} ${entry.file}`.toLowerCase()
  const idx = text.indexOf(token)
  if (idx >= 0) return substringScore(token, text, idx)
  const sub = subsequenceScore(token, text)
  if (sub !== null && token.length >= 3) return sub
  const helpText = `${entry.description} ${entry.body}`.toLowerCase()
  return token.length >= 3 && helpText.includes(token) ? 6 : null
}

function scoreEntry(tokens: string[], entry: AutoEntry): number | null {
  let total = 0
  for (const token of tokens) {
    const score = matchToken(token, entry)
    if (score === null) return null
    total += score
  }
  return total - entry.title.length * 2
}

export function search(query: string, pool: AutoEntry[]): AutoEntry[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return pool
  return pool
    .map((entry) => ({ entry, score: scoreEntry(tokens, entry) }))
    .filter((m): m is { entry: AutoEntry; score: number } => m.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((m) => m.entry)
}
