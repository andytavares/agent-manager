import { expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { App } from "../../src/app/App"
import type { HarnessAdapter, HarnessId, Item, ItemDetail, Roots } from "../../src/core/model"

const roots: Roots = { home: "/home/u", project: "/home/u/repo", env: {} }

const items: Item[] = [
  { kind: "memory", harness: "claude-code", scope: "global", name: "CLAUDE.md", path: "/home/u/.claude/CLAUDE.md", loadedBy: ["claude-code"] },
  { kind: "mcp", harness: "claude-code", scope: "global", name: "linear", path: "/home/u/.claude.json", key: "mcpServers.linear", loadedBy: ["claude-code"], readOnly: "managed by policy" },
  { kind: "mcp", harness: "codex", scope: "global", name: "playwright", path: "/home/u/.codex/config.toml", key: "mcp_servers.playwright", loadedBy: ["codex"] },
  { kind: "mcp", harness: "claude-code", scope: "project", name: "postgres", path: "/home/u/repo/.mcp.json", key: "mcpServers.postgres", loadedBy: ["claude-code"] },
]

const details: Record<string, ItemDetail> = {
  linear: {
    type: "mcp",
    server: { name: "linear", transport: "http", enabled: true, url: "https://mcp.linear.app/mcp", headers: { Authorization: "Bearer sk-secret-1" }, native: {} },
  },
  playwright: { type: "mcp", server: { name: "playwright", transport: "stdio", enabled: true, command: "npx", native: {} } },
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

async function renderApp(onQuit = () => {}) {
  return testRender(<App adapters={adapters} roots={roots} onQuit={onQuit} />, { width: 110, height: 24 })
}

test("pressing 2 lists MCP servers of the global scope", async () => {
  const setup = await renderApp()
  try {
    await setup.waitForFrame((frame) => frame.includes("CLAUDE.md"))
    setup.mockInput.pressKey("2")
    const frame = await setup.waitForFrame((f) => f.includes("playwright"))
    expect(frame).toContain("linear")
    expect(frame).toContain("stdio")
    expect(frame).not.toContain("postgres")
  } finally {
    setup.renderer.destroy()
  }
})

test("s switches to project scope and filters the list", async () => {
  const setup = await renderApp()
  try {
    setup.mockInput.pressKey("2")
    await setup.waitForFrame((f) => f.includes("playwright"))
    setup.mockInput.pressKey("s")
    const frame = await setup.waitForFrame((f) => f.includes("postgres"))
    expect(frame).not.toContain("playwright")
  } finally {
    setup.renderer.destroy()
  }
})

test("selecting a harness filters the list", async () => {
  const setup = await renderApp()
  try {
    setup.mockInput.pressKey("2")
    await setup.waitForFrame((f) => f.includes("playwright"))
    setup.mockInput.pressTab() // focus moves from the list to the harness pane
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressArrow("down") // Codex
    const frame = await setup.waitForFrame((f) => !f.includes("linear"))
    expect(frame).toContain("playwright")
  } finally {
    setup.renderer.destroy()
  }
})

test("detail masks header values and shows the read-only reason", async () => {
  const setup = await renderApp()
  try {
    setup.mockInput.pressKey("2")
    const frame = await setup.waitForFrame((f) => f.includes("Authorization"))
    expect(frame).toContain("••••••••")
    expect(frame).not.toContain("sk-secret-1")
    expect(frame).toContain("managed by policy")
    expect(frame).toContain("mcpServers.linear")
  } finally {
    setup.renderer.destroy()
  }
})

test("q calls onQuit", async () => {
  let quits = 0
  const setup = await renderApp(() => quits++)
  try {
    setup.mockInput.pressKey("q")
    await setup.waitFor(() => quits === 1)
    expect(quits).toBe(1)
  } finally {
    setup.renderer.destroy()
  }
})

test("a long detail text stays inside its pane and keeps the header visible", async () => {
  const long: HarnessAdapter = {
    ...fakeAdapter("claude-code", "Claude Code"),
    read: async () => ({ type: "text", text: Array.from({ length: 80 }, (_, n) => `line ${n}`).join("\n") }),
  }
  const setup = await testRender(<App adapters={[long]} roots={roots} onQuit={() => {}} />, { width: 110, height: 24 })
  try {
    const frame = await setup.waitForFrame((f) => f.includes("line 3"))
    expect(frame).toContain("1 Memory")
    expect(frame).toContain("q quit")
  } finally {
    setup.renderer.destroy()
  }
})

test("/ filters the list by name; esc clears the filter", async () => {
  const setup = await renderApp()
  try {
    setup.mockInput.pressKey("2")
    await setup.waitForFrame((f) => f.includes("playwright"))
    setup.mockInput.pressKey("/")
    await setup.mockInput.typeText("play")
    await setup.renderOnce()
    const filtered = setup.captureCharFrame()
    expect(filtered).toContain("filter: play")
    expect(filtered).toContain("playwright")
    expect(filtered).not.toContain("linear      http") // the list row, not the detail pane
    setup.mockInput.pressEscape() // a lone escape is delivered after a short delay
    let cleared = ""
    for (let tries = 0; tries < 40 && !cleared.includes("linear      http"); tries++) {
      await Bun.sleep(25)
      await setup.renderOnce()
      cleared = setup.captureCharFrame()
    }
    expect(cleared).toContain("linear      http")
    expect(cleared).not.toContain("filter:")
  } finally {
    setup.renderer.destroy()
  }
})

test("? shows the keys for every tab", async () => {
  const setup = await renderApp()
  try {
    await setup.waitForFrame((f) => f.includes("CLAUDE.md"))
    setup.mockInput.pressKey("?")
    const help = await setup.waitForFrame((f) => f.includes("Keys"))
    expect(help).toContain("i install")
    expect(help).toContain("c copy to")
  } finally {
    setup.renderer.destroy()
  }
})
