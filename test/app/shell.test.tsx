import { expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { App } from "../../src/app/App"
import type { HarnessAdapter, HarnessId, Item, Roots } from "../../src/core/model"

const roots: Roots = { home: "/home/u", project: "/home/u/repo", env: {} }

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

test("the list screen shows the tabs, the Agents and Project panels and a GLOBAL group row", async () => {
  const setup = await testRender(<App adapters={adapters} roots={roots} onQuit={() => {}} />, { width: 100, height: 24 })
  try {
    const frame = await setup.waitForFrame((f) => f.includes("CLAUDE.md"))
    expect(frame).toContain("1 Memory")
    expect(frame).toContain("2 Skills")
    expect(frame).toContain("3 MCP")
    expect(frame).toContain("4 Plugins")
    expect(frame).toContain("5 Health")
    expect(frame).toContain("Agents")
    expect(frame).toContain("Project")
    expect(frame).toContain("GLOBAL")
  } finally {
    setup.renderer.destroy()
  }
})

test("pressing 5 shows the Health placeholder", async () => {
  const setup = await testRender(<App adapters={adapters} roots={roots} onQuit={() => {}} />, { width: 100, height: 24 })
  try {
    await setup.waitForFrame((f) => f.includes("CLAUDE.md"))
    setup.mockInput.pressKey("5")
    const frame = await setup.waitForFrame((f) => f.includes("No issues."))
    expect(frame).toContain("5 Health")
  } finally {
    setup.renderer.destroy()
  }
})
