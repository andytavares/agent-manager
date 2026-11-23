import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { backlinks, loadEntries, parseEntryFrontmatter, parseIndex } from "../../src/memory/entry"
import type { AutoEntry } from "../../src/memory/types"

const INDEX = `- [Plain voice](feedback_plain_voice.md) — no flattery, short sentences
- [Vault secrets runbook](reference_vault.md) — self-service path in eng-handbook
- [Verify the bot](feedback_verify_bot.md) — check its claims against primary sources
- [Deleted entry](project_gone.md) — this file no longer exists
`
const PLAIN_VOICE = `---
name: feedback-plain-voice
description: "No flattery; short plain sentences"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 11111111-1111-1111-1111-111111111111
  modified: 2026-10-01T10:00:00.000Z
---

Write plainly. See [[reference_vault]] and [[feedback_verify_bot]].
`
const VERIFY_BOT = `---
name: ""
metadata:
  node_type: memory
  originSessionId: 22222222-2222-2222-2222-222222222222
---

The bot is not a person. Verify its claims. See [[feedback-plain-voice]].
`
const ORPHAN = `---
name: project-orphan
description: Not in the index
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

Runbook lives in eng-handbook. Missing: [[project_capex_check]]. Shell: \`[[ $code -ne 0 ]]\`.
`

function memoryDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "memory-"))
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

const byFile = (entries: AutoEntry[], file: string) => entries.find((e) => e.file === file)!!

describe("parseEntryFrontmatter", () => {
  test("reads valid YAML", () => {
    expect(parseEntryFrontmatter("name: a\ntype: user")).toEqual({ meta: { name: "a", type: "user" }, valid: true })
  })

  test("falls back to key: value lines when YAML is invalid", () => {
    const { meta, valid } = parseEntryFrontmatter("description: Where: here\ntype: reference")
    expect(valid).toBe(false)
    expect(meta.type).toBe("reference")
  })

  test("keeps a nested metadata type when YAML is invalid", () => {
    const { meta, valid } = parseEntryFrontmatter("name: x\ndescription: Where: it lives\nmetadata:\n  type: reference")
    expect(valid).toBe(false)
    expect(meta.metadata?.type).toBe("reference")
  })
})

describe("parseIndex", () => {
  test("keeps index lines and ignores the rest", () => {
    const rows = parseIndex("# Memory\n- [A title](a.md) — the hook\nnot a line\n- [B](b.md) - dash hook\n")
    expect(rows).toEqual([
      { line: 2, title: "A title", file: "a.md", hook: "the hook" },
      { line: 4, title: "B", file: "b.md", hook: "dash hook" },
    ])
  })
})

describe("loadEntries", () => {
  test("loads the four entries, indexed first and orphans last", () => {
    expect(loadEntries(fixture()).map((e) => e.file)).toEqual([
      "feedback_plain_voice.md",
      "reference_vault.md",
      "feedback_verify_bot.md",
      "project_orphan.md",
    ])
  })

  test("takes type from the filename prefix and name from the file name when name is empty", () => {
    const bot = byFile(loadEntries(fixture()), "feedback_verify_bot.md")
    expect(bot.name).toBe("feedback_verify_bot")
    expect(bot.type).toBe("feedback")
    expect(bot.title).toBe("Verify the bot")
    expect(bot.hook).toBe("check its claims against primary sources")
  })

  test("reads type from metadata and a modified date", () => {
    const voice = byFile(loadEntries(fixture()), "feedback_plain_voice.md")
    expect(voice.type).toBe("feedback")
    expect(voice.modified).toBe("2026-10-01")
    expect(voice.indexLine).toBe(1)
  })

  test("marks invalid frontmatter but still reads its type", () => {
    const vault = byFile(loadEntries(fixture()), "reference_vault.md")
    expect(vault.frontmatterValid).toBe(false)
    expect(vault.type).toBe("reference")
  })

  test("an unindexed entry has no index line and uses its name as title", () => {
    const orphan = byFile(loadEntries(fixture()), "project_orphan.md")
    expect(orphan.indexLine).toBeNull()
    expect(orphan.title).toBe("project-orphan")
    expect(orphan.pastLoadLimit).toBe(false)
  })

  test("ignores [[ ]] inside code spans when collecting links", () => {
    const entries = loadEntries(fixture())
    expect(byFile(entries, "reference_vault.md").links).toEqual(["project_capex_check"])
    expect(byFile(entries, "feedback_plain_voice.md").links).toEqual(["reference_vault", "feedback_verify_bot"])
  })

  test("marks index lines past line 200 as past the load limit", () => {
    const rows = Array.from({ length: 201 }, (_, i) => `- [T${i + 1}](project_${i + 1}.md) — hook`)
    const files: Record<string, string> = { "MEMORY.md": rows.join("\n") + "\n" }
    for (const n of [200, 201]) files[`project_${n}.md`] = "---\nname: n\n---\nbody"
    const loaded = loadEntries(memoryDir(files))
    expect(byFile(loaded, "project_200.md").pastLoadLimit).toBe(false)
    expect(byFile(loaded, "project_201.md").pastLoadLimit).toBe(true)
  })

  test("marks index lines past 25,600 bytes as past the load limit", () => {
    const long = `- [Long](project_long.md) — ${"x".repeat(26_000)}\n- [Late](project_late.md) — hook\n`
    const loaded = loadEntries(memoryDir({ "MEMORY.md": long, "project_long.md": "body", "project_late.md": "body" }))
    expect(byFile(loaded, "project_late.md").pastLoadLimit).toBe(true)
  })

  test("index rows and frontmatter parse with CRLF line endings", () => {
    const dir = memoryDir({
      "MEMORY.md": INDEX.replaceAll("\n", "\r\n"),
      "feedback_plain_voice.md": PLAIN_VOICE.replaceAll("\n", "\r\n"),
    })
    const entry = byFile(loadEntries(dir), "feedback_plain_voice.md")
    expect(entry.indexLine).toBe(1)
    expect(entry.frontmatterValid).toBe(true)
    expect(entry.name).toBe("feedback-plain-voice")
  })
})

describe("backlinks", () => {
  test("finds entries that link to the target by name or by file stem", () => {
    const entries = loadEntries(fixture())
    const files = (target: AutoEntry) => backlinks(entries, target).map((e) => e.file)
    expect(files(byFile(entries, "feedback_verify_bot.md"))).toEqual(["feedback_plain_voice.md"])
    expect(files(byFile(entries, "feedback_plain_voice.md"))).toEqual(["feedback_verify_bot.md"])
  })
})

describe("parseIndex", () => {
  test("reads an index row that has no description", () => {
    expect(parseIndex("- [no-desc](no-desc.md)\n")).toEqual([{ line: 1, title: "no-desc", file: "no-desc.md", hook: "" }])
  })
})
