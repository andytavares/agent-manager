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

// A lone escape is delivered after a short delay, so poll until the frame shows text.
async function pressEscapeUntil(setup: Awaited<ReturnType<typeof renderApp>>, text: string): Promise<string> {
  setup.mockInput.pressEscape()
  let frame = ""
  for (let tries = 0; tries < 40 && !frame.includes(text); tries++) {
    await Bun.sleep(25)
    await setup.renderOnce()
    frame = setup.captureCharFrame()
  }
  return frame
}

test("pressing 3 lists the MCP servers of both scopes", async () => {
  const setup = await renderApp()
  try {
    await setup.waitForFrame((frame) => frame.includes("CLAUDE.md"))
    setup.mockInput.pressKey("3")
    const frame = await setup.waitForFrame((f) => f.includes("playwright") && f.includes("type      http"))
    expect(frame).toContain("linear")
    expect(frame).toContain("postgres")
  } finally {
    setup.renderer.destroy()
  }
})

test("p opens the project picker; esc keeps the current project and the list shows both scopes", async () => {
  const setup = await renderApp()
  try {
    setup.mockInput.pressKey("3")
    await setup.waitForFrame((f) => f.includes("playwright"))
    setup.mockInput.pressKey("p")
    await setup.waitForFrame((f) => f.includes("Projects"))
    const frame = await pressEscapeUntil(setup, "postgres")
    expect(frame).toContain("postgres")
    expect(frame).toContain("playwright")
    expect(frame).toContain("GLOBAL")
    expect(frame).toContain("PROJECT  ~/repo")
  } finally {
    setup.renderer.destroy()
  }
})

test("selecting an agent filters the list", async () => {
  const setup = await renderApp()
  try {
    setup.mockInput.pressKey("3")
    await setup.waitForFrame((f) => f.includes("playwright"))
    setup.mockInput.pressTab() // focus moves from the list to the Agents panel
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressArrow("down") // Codex
    const frame = await setup.waitForFrame((f) => !f.includes("mcpServers.linear"))
    expect(frame).toContain("playwright")
  } finally {
    setup.renderer.destroy()
  }
})

test("s cycles the agent filter from All to each adapter", async () => {
  const setup = await renderApp()
  try {
    setup.mockInput.pressKey("3")
    await setup.waitForFrame((f) => f.includes("playwright"))
    setup.mockInput.pressKey("s") // All → Claude Code
    const claude = await setup.waitForFrame((f) => !f.includes("mcpServers.playwright"))
    expect(claude).toContain("All agents")
    setup.mockInput.pressKey("s") // Claude Code → Codex
    const codex = await setup.waitForFrame((f) => f.includes("Codex · s agent"))
    expect(codex).toContain("playwright")
    expect(codex).not.toContain("mcpServers.linear")
  } finally {
    setup.renderer.destroy()
  }
})

test("detail masks header values and shows the read-only reason", async () => {
  const setup = await renderApp()
  try {
    setup.mockInput.pressKey("3")
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
    setup.mockInput.pressKey("3")
    await setup.waitForFrame((f) => f.includes("playwright"))
    setup.mockInput.pressKey("/")
    await setup.mockInput.typeText("play")
    await setup.renderOnce()
    const filtered = setup.captureCharFrame()
    expect(filtered).toContain("filter: play")
    expect(filtered).toContain("playwright")
    expect(filtered).not.toContain("linear              user") // the list row, not the detail pane
    const cleared = await pressEscapeUntil(setup, "linear              user")
    expect(cleared).toContain("linear              user")
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
