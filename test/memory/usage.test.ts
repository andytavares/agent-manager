import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mcpUsage, readUses, sinceNote, skillUsage, transcriptsSince } from "../../src/memory/usage"

// One record per line, as Claude Code writes a transcript.
const TRANSCRIPT = [
  '{"type":"user","cwd":"/tmp/repo","sessionId":"a"}',
  '{"type":"assistant","timestamp":"2026-10-01T10:00:00Z","message":{"content":[{"type":"tool_use","id":"t1","name":"mcp__github__create_issue","input":{}}]}}',
  '{"type":"assistant","timestamp":"2026-10-02T10:00:00Z","message":{"content":[{"type":"text","text":"ok"},{"type":"tool_use","id":"t2","name":"mcp__github__list_issues","input":{}}]}}',
  '{"type":"assistant","timestamp":"2026-10-03T10:00:00Z","message":{"content":[{"type":"tool_use","id":"t3","name":"mcp__claude_ai_Slack__slack_search","input":{}}]}}',
  '{"type":"assistant","timestamp":"2026-10-04T10:00:00Z","message":{"content":[{"type":"tool_use","id":"t4","name":"Skill","input":{"skill":"format"}}]}}',
  '{"type":"assistant","timestamp":"2026-10-05T10:00:00Z","message":{"content":[{"type":"tool_use","id":"t5","name":"Skill","input":{"skill":"fmt:format"}}]}}',
  '{"type":"user","timestamp":"2026-10-06T10:00:00Z","message":{"role":"user","content":"<command-name>/review:review</command-name>"}}',
].join("\n")

let config: string

function configWith(folders: Record<string, string>): string {
  config = mkdtempSync(join(tmpdir(), "agent-manager-usage-"))
  for (const [folder, text] of Object.entries(folders)) {
    mkdirSync(join(config, "projects", folder), { recursive: true })
    writeFileSync(join(config, "projects", folder, "s1.jsonl"), text)
  }
  return config
}

afterEach(() => {
  rmSync(config, { recursive: true, force: true })
})

describe("readUses", () => {
  test("gives every MCP call, skill and slash command with its project folder and date", () => {
    const uses = readUses(configWith({ "-tmp-repo": TRANSCRIPT }))
    expect(uses).toEqual([
      { key: "mcp:github", folder: "-tmp-repo", date: "2026-10-01" },
      { key: "mcp:github", folder: "-tmp-repo", date: "2026-10-02" },
      { key: "mcp:claude_ai_Slack", folder: "-tmp-repo", date: "2026-10-03" },
      { key: "command:format", folder: "-tmp-repo", date: "2026-10-04" },
      { key: "command:fmt:format", folder: "-tmp-repo", date: "2026-10-05" },
      { key: "command:review:review", folder: "-tmp-repo", date: "2026-10-06" },
    ])
  })

  test("reads every project folder and skips lines that are not records", () => {
    const uses = readUses(configWith({ "-tmp-repo": `${TRANSCRIPT}\nnot json\n`, "-tmp-other": TRANSCRIPT }))
    expect(uses.filter((use) => use.key === "mcp:github").map((use) => use.folder)).toEqual([
      "-tmp-repo",
      "-tmp-repo",
      "-tmp-other",
      "-tmp-other",
    ])
  })

  test("returns nothing when the config has no projects folder", () => {
    config = mkdtempSync(join(tmpdir(), "agent-manager-usage-"))
    expect(readUses(config)).toEqual([])
    expect(transcriptsSince(config)).toBeNull()
  })
})

describe("usage of one item", () => {
  test("counts an MCP server, a connector and a skill by name, here and overall", () => {
    const uses = readUses(configWith({ "-tmp-repo": TRANSCRIPT }))
    expect(mcpUsage("github", uses, ["-tmp-repo"])).toEqual({ here: 2, all: 2, last: "2026-10-02" })
    expect(mcpUsage("claude.ai Slack", uses, ["-tmp-repo"])).toEqual({ here: 1, all: 1, last: "2026-10-03" })
    expect(skillUsage("format", uses, ["-tmp-repo"])).toEqual({ here: 2, all: 2, last: "2026-10-05" })
  })

  test("here counts only the transcript folders of the current project", () => {
    const uses = readUses(configWith({ "-tmp-repo": TRANSCRIPT, "-tmp-other": TRANSCRIPT }))
    expect(mcpUsage("github", uses, ["-tmp-repo"])).toEqual({ here: 2, all: 4, last: "2026-10-02" })
  })

  test("an item with no call reports never", () => {
    const uses = readUses(configWith({ "-tmp-repo": TRANSCRIPT }))
    expect(mcpUsage("playwright", uses, ["-tmp-repo"])).toEqual({ here: 0, all: 0, last: null })
  })
})

describe("transcriptsSince", () => {
  test("reports the oldest transcript date, so the footer can name it", () => {
    const uses = readUses(configWith({ "-tmp-repo": TRANSCRIPT }))
    expect(uses).toHaveLength(6)
    expect(transcriptsSince(config)).toBe(new Date().toISOString().slice(0, 10))
  })

  test("the footer names the date, or says none were found", () => {
    expect(sinceNote("2026-10-01")).toBe("here / all count Claude Code transcripts since 2026-10-01.")
    expect(sinceNote(null)).toBe("here / all count Claude Code transcripts; none were found.")
  })
})
