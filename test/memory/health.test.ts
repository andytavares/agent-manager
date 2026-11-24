import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadEntries } from "../../src/memory/entry"
import { checkHealth } from "../../src/memory/health"
import type { Source } from "../../src/memory/types"

const INDEX = `- [Plain voice](feedback_plain_voice.md) — no flattery, short sentences
- [Vault secrets runbook](reference_vault.md) — self-service path in eng-handbook
- [Verify the bot](feedback_verify_bot.md) — check its claims against primary sources
- [Deleted entry](project_gone.md) — this file no longer exists
`
const PLAIN_VOICE = `---
name: feedback-plain-voice
description: "No flattery; short plain sentences"
metadata:
  type: feedback
  modified: 2026-10-01T10:00:00.000Z
---

Write plainly. See [[reference_vault]] and [[feedback_verify_bot]].
`
const VERIFY_BOT = `---
name: ""
metadata:
  type: feedback
---

The bot is not a person. Verify its claims. See [[feedback-plain-voice]].
`
const ORPHAN = `---
name: project-orphan
metadata:
  type: project
---

Nobody indexed me.
`
const VAULT = `---
name: reference_vault
description: Where the handbook documents it: kv_team_role_usage.md
type: reference
---

Runbook lives in eng-handbook. Missing: [[project_capex_check]].
`

function memoryDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "memory-health-"))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  return dir
}

const fixture = () =>
  memoryDir({
    "MEMORY.md": INDEX,
    "feedback_plain_voice.md": PLAIN_VOICE,
    "feedback_verify_bot.md": VERIFY_BOT,
    "project_orphan.md": ORPHAN,
    "reference_vault.md": VAULT,
  })

describe("checkHealth", () => {
  test("reports one orphan, one dead index line, one broken link and one bad frontmatter", () => {
    const dir = fixture()
    const issues = checkHealth(loadEntries(dir), dir, [])
    const kinds = (kind: string) => issues.filter((i) => i.kind === kind)
    expect(kinds("orphan").map((i) => i.path)).toEqual([join(dir, "project_orphan.md")])
    expect(kinds("dead-index").map((i) => i.detail)).toEqual([expect.stringContaining("project_gone.md")])
    expect(kinds("broken-link")).toHaveLength(1)
    expect(kinds("broken-link")[0]!.detail).toContain("project_capex_check")
    expect(kinds("bad-frontmatter").map((i) => i.path)).toEqual([join(dir, "reference_vault.md")])
  })

  test("reports nothing for past-limit or over-budget on the fixture", () => {
    const dir = fixture()
    const issues = checkHealth(loadEntries(dir), dir, [])
    expect(issues.filter((i) => i.kind === "past-limit")).toHaveLength(0)
    expect(issues.filter((i) => i.kind === "over-budget")).toHaveLength(0)
  })
})

describe("health budget", () => {
  test("flags an instruction file over 200 lines as over-budget", () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-budget-"))
    const path = join(dir, "CLAUDE.md")
    writeFileSync(path, "line\n".repeat(201))
    const instruction: Source = {
      level: "global",
      kind: "claude-md",
      path,
      readOnly: false,
      loadsAtStart: true,
      lines: 201,
      bytes: 1206,
      mtimeMs: 0,
    }
    const issues = checkHealth([], dir, [instruction])
    expect(issues.filter((i) => i.kind === "over-budget")).toHaveLength(1)
    expect(issues.find((i) => i.kind === "over-budget")!.path).toBe(path)
  })

  test("flags a MEMORY.md over 200 lines", () => {
    const dir = fixture()
    const index = join(dir, "MEMORY.md")
    const extra = Array.from({ length: 200 }, (_, i) => `- [x${i}](x${i}.md) — h`).join("\n")
    writeFileSync(index, readFileSync(index, "utf8") + extra)
    const issues = checkHealth(loadEntries(dir), dir, [])
    expect(issues.some((i) => i.kind === "over-budget" && i.path === index)).toBe(true)
  })
})

describe("index budget", () => {
  test("a MEMORY.md of exactly 200 lines with a final newline is within budget", () => {
    const dir = mkdtempSync(join(tmpdir(), "health-budget-"))
    writeFileSync(join(dir, "MEMORY.md"), Array.from({ length: 200 }, (_, i) => `- [e${i}](e${i}.md)`).join("\n") + "\n")
    expect(checkHealth([], dir, []).filter((issue) => issue.kind === "over-budget")).toEqual([])
  })
})
