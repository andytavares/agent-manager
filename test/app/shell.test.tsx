import { expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { App } from "../../src/app/App"
import type { HarnessAdapter, HarnessId, Item, ItemDetail, Roots } from "../../src/core/model"

const roots: Roots = { home: "/home/u", project: "/home/u/repo", env: {} }

const items: Item[] = [
  { kind: "memory", harness: "claude-code", scope: "global", name: "CLAUDE.md", path: "/home/u/.claude/CLAUDE.md", loadedBy: ["claude-code"] },
  { kind: "memory", harness: "claude-code", scope: "project", name: "CLAUDE.local.md", path: "/home/u/repo/CLAUDE.local.md", loadedBy: ["claude-code"] },
  { kind: "mcp", harness: "codex", scope: "global", name: "postgres", path: "/home/u/.codex/config.toml", key: "mcp_servers.postgres", loadedBy: ["codex"] },
]

const details: Record<string, ItemDetail> = {
  postgres: { type: "mcp", server: { name: "postgres", transport: "stdio", enabled: true, command: "pg", native: {} } },
}

function fakeAdapter(id: HarnessId, label: string): HarnessAdapter {
  return {
    id,
    label,
    scopes: ["global", "project"],
    detect: async () => true,
    list: async (kind) => items.filter((item) => item.kind === kind && item.harness === id),
    read: async (item) => details[item.name] ?? { type: "text", text: `text of ${item.name}` },
    plan: async () => ({ edits: [], moves: [], copies: [], removals: [], commands: [], notices: [] }),
    memoryFiles: {},
    skillRoots: async () => [],
  }
}

const adapters = [fakeAdapter("claude-code", "Claude Code"), fakeAdapter("codex", "Codex")]
const LEFT_COLUMN_RIGHT = 27 // the left column panels' right edge at 100 columns

test("the list screen shows the tabs, the Harnesses and Project panels and a GLOBAL group row", async () => {
  const setup = await testRender(<App adapters={adapters} roots={roots} onQuit={() => {}} />, { width: 100, height: 24 })
  try {
    const frame = await setup.waitForFrame((f) => f.includes("CLAUDE.md"))
    expect(frame).toContain("1 Memory")
    expect(frame).toContain("2 Skills")
    expect(frame).toContain("3 MCP")
    expect(frame).toContain("4 Plugins")
    expect(frame).toContain("5 Health")
    expect(frame).toContain("Harnesses")
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

test("the MCP screen at 100x24 keeps every line within the width and the detail strip inside the list panel", async () => {
  const setup = await testRender(<App adapters={adapters} roots={roots} onQuit={() => {}} />, { width: 100, height: 24 })
  try {
    const frame = await openMcpTab(setup)
    expect(frame.split("\n").filter((line) => [...line].length > 100)).toEqual([])
    expect(frame).toContain("3 MCP 1")
    expect(frame).toMatch(/All harnesses\s+1/)
    expect(frame).toMatch(/Claude Code\s+0/)
    expect(frame).toMatch(/Codex\s+1/)
    assertStripInPanel(frame.split("\n").filter((line) => line !== ""))
  } finally {
    setup.renderer.destroy()
  }
})

test("the key bar is one line at 100x24", async () => {
  const setup = await testRender(<App adapters={adapters} roots={roots} onQuit={() => {}} />, { width: 100, height: 24 })
  try {
    const frame = await setup.waitForFrame((f) => f.includes("CLAUDE.md"))
    const lines = frame.split("\n").filter((line) => line !== "")
    // The bar is the last row; a wrapped bar would push its head onto the row above.
    const bar = lines.at(-1)!
    expect(bar).toContain("a add")
    expect(bar).toContain("? all keys")
    expect(bar.indexOf("? all keys")).toBeGreaterThan(bar.indexOf("d delete"))
  } finally {
    setup.renderer.destroy()
  }
})

async function openMcpTab(setup: Awaited<ReturnType<typeof testRender>>): Promise<string> {
  await setup.waitForFrame((f) => f.includes("CLAUDE.md"))
  setup.mockInput.pressKey("3")
  return waitForText(setup, "MCP servers · 1")
}

// The detail strip and its dashed rule sit inside the list panel, and both columns end on the same row.
function assertStripInPanel(lines: string[]) {
  // The list panel's top row runs from its top-left corner to its top-right corner.
  const panel = lines.find((line) => line.includes("MCP servers"))
  expect(panel).toBeDefined()
  const left = panel!.lastIndexOf("╭")
  const right = panel!.lastIndexOf("╮")

  const opened = lines.filter((line) => [...line][left] === "│")
  expect(opened.length).toBeGreaterThan(0)
  expect(opened.filter((line) => [...line][right] !== "│")).toEqual([])

  const detail = lines.filter((line) => line.includes("stdio") || line.includes("postgres"))
  expect(detail.length).toBeGreaterThan(0)
  expect(detail.filter((line) => !opened.includes(line))).toEqual([])

  const rule = lines.find((line) => [...line][left] === "│" && /^┄+$/.test([...line].slice(left + 1, right).join("")))
  expect(rule).toBeDefined()
  expect([...rule!].slice(left + 1, right).join("").length).toBe(right - left - 1)

  const leftBottom = lines.findLastIndex((line) => [...line][LEFT_COLUMN_RIGHT] === "╯")
  const rightBottom = lines.findIndex((line) => [...line][right] === "╯")
  expect(leftBottom).toBe(rightBottom)
}

async function waitForText(setup: Awaited<ReturnType<typeof testRender>>, text: string): Promise<string> {
  let frame = ""
  for (let tries = 0; tries < 60 && !frame.includes(text); tries++) {
    await Bun.sleep(20)
    await setup.renderOnce()
    frame = setup.captureCharFrame()
  }
  return frame
}
