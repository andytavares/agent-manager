import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { testRender } from "@opentui/react/test-utils"
import { App } from "../../src/app/App"
import type { HarnessAdapter, HarnessId, Item, Roots } from "../../src/core/model"

// The same four entries as the claude-memory-desk fixture: two indexed, one orphan, one bad header.
const INDEX = `- [Plain voice](feedback_plain_voice.md) — no flattery, short sentences
- [Vault secrets runbook](reference_vault.md) — self-service path in eng-handbook
- [Verify the bot](feedback_verify_bot.md) — check its claims against primary sources
- [Deleted entry](project_gone.md) — this file no longer exists
`
const FILES: Record<string, string> = {
  "MEMORY.md": INDEX,
  "feedback_plain_voice.md": `---
name: feedback-plain-voice
description: "No flattery; short plain sentences"
metadata:
  node_type: memory
  type: feedback
---

Write plainly. See [[reference_vault]] and [[feedback_verify_bot]].
`,
  "reference_vault.md": `---
name: reference_vault
description: Where the handbook documents it: kv_team_role_usage.md
type: reference
---

Runbook lives in eng-handbook. Missing: [[project_capex_check]].
`,
  "feedback_verify_bot.md": `---
name: ""
metadata:
  node_type: memory
---

The bot is not a person. Verify its claims. See [[feedback-plain-voice]].
`,
  "project_orphan.md": `---
name: project-orphan
description: Not in the index
metadata:
  type: project
---

Nobody indexed me.
`,
}

const items: Item[] = [
  { kind: "memory", harness: "claude-code", scope: "global", name: "CLAUDE.md", path: "/home/u/.claude/CLAUDE.md", loadedBy: ["claude-code"] },
  { kind: "memory", harness: "claude-code", scope: "project", name: "CLAUDE.local.md", path: "/home/u/repo/CLAUDE.local.md", loadedBy: ["claude-code"] },
]

function fakeAdapter(id: HarnessId, label: string): HarnessAdapter {
  return {
    id,
    label,
    scopes: ["global", "project"],
    detect: async () => true,
    list: async (kind) => items.filter((item) => item.kind === kind && item.harness === id),
    read: async (item) => ({ type: "text", text: `text of ${item.name}` }),
    plan: async () => ({ edits: [], moves: [], copies: [], removals: [], commands: [], notices: [] }),
    memoryFiles: {},
    skillRoots: async () => [],
  }
}

const adapters = [fakeAdapter("claude-code", "Claude Code"), fakeAdapter("codex", "Codex")]

// A temp home whose Claude Code config holds one project's auto memory folder.
function autoMemoryHome(): { home: string; roots: Roots } {
  const home = mkdtempSync(join(tmpdir(), "memory-tab-"))
  const project = join(home, "repo")
  const memoryDir = join(home, ".claude", "projects", project.replace(/[/.]/g, "-"), "memory")
  mkdirSync(memoryDir, { recursive: true })
  for (const [name, text] of Object.entries(FILES)) writeFileSync(join(memoryDir, name), text)
  return { home, roots: { home, project, env: {} } }
}

type Setup = Awaited<ReturnType<typeof testRender>>

async function waitForText(setup: Setup, text: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await setup.waitForFrame((frame) => frame.includes(text))
    } catch (error) {
      if (attempt === 200) throw error
      await Bun.sleep(10)
    }
  }
}

async function renderMemoryTab() {
  const { home, roots } = autoMemoryHome()
  const setup = await testRender(<App adapters={adapters} roots={roots} onQuit={() => {}} />, { width: 120, height: 34 })
  return { setup, cleanup: () => { setup.renderer.destroy(); rmSync(home, { recursive: true, force: true }) } }
}

test("the Memory tab lists the auto memory entries with their type and flags and the index budget", async () => {
  const { setup, cleanup } = await renderMemoryTab()
  try {
    const frame = await waitForText(setup, "AUTO MEMORY")
    expect(frame).toContain("Plain voice")
    expect(frame).toContain("Vault secrets runbook")
    expect(frame).toContain("Verify the bot")
    expect(frame).toContain("project-orphan")
    expect(frame).toContain("not in MEMORY.md, not loaded at start")
    expect(frame).toMatch(/feedback\s+Plain voice/)
    expect(frame).toContain("of 200 lines")
    // The instruction files stay in the groups above the entries.
    expect(frame).toContain("CLAUDE.md")
  } finally {
    cleanup()
  }
})

test("selecting an entry fills the detail strip with its links out and linked from", async () => {
  const { setup, cleanup } = await renderMemoryTab()
  try {
    await waitForText(setup, "AUTO MEMORY")
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressArrow("down")
    const frame = await waitForText(setup, "links out")
    expect(frame).toContain("Plain voice  feedback · MEMORY.md line 1 · loaded at start ✓")
    expect(frame).toContain("links out   [[reference_vault]]  [[feedback_verify_bot]]")
    expect(frame).toContain("linked from feedback_verify_bot")
  } finally {
    cleanup()
  }
})

test("/ on the Memory tab searches entries by title, name, file and body", async () => {
  const { setup, cleanup } = await renderMemoryTab()
  try {
    await waitForText(setup, "AUTO MEMORY")
    setup.mockInput.pressKey("/")
    await setup.mockInput.typeText("vault")
    const frame = await waitForText(setup, "Vault secrets runbook  reference")
    expect(frame).toContain("/ vault▌")
    // "Verify the bot" matches none of the fields, so the fuzzy search drops it.
    expect(frame).not.toContain("Verify the bot")
    expect(frame).toContain("MEMORY.md line 2")
  } finally {
    cleanup()
  }
})
