import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { testRender } from "@opentui/react/test-utils"
import { EMPTY_PLAN } from "./fake-skills"
import type { Change, HarnessAdapter, HarnessId, Item, McpServer, Roots, Scope } from "../../src/core/model"

const { App } = await import("../../src/app/App")

let home: string
let roots: Roots
let changes: Change[]
let linear: Item

const LINEAR: McpServer = {
  name: "linear",
  transport: "http",
  enabled: true,
  url: "https://mcp.linear.app/mcp",
  headers: { Authorization: "Bearer sk-live-123" },
  native: { timeout: 30 }, // a harness-only key that must not travel to another harness
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "agent-manager-mcp-"))
  roots = { home, project: join(home, "repo"), env: {} }
  changes = []
  linear = { kind: "mcp", harness: "claude-code", scope: "global", name: "linear", path: join(home, ".claude.json"), key: "mcpServers.linear", loadedBy: ["claude-code"] }
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

// plan() returns an edit at /planned/<harness>/<scope>.json holding the server, or a remove command on delete.
function fakeAdapter(id: HarnessId, label: string, fail?: string): HarnessAdapter {
  const scopes: Scope[] = id === "claude-code" ? ["global", "project", "local"] : ["global", "project"]
  return {
    id,
    label,
    scopes,
    detect: async () => true,
    list: async (kind) => (kind === "mcp" && id === "claude-code" ? [linear] : []),
    read: async () => ({ type: "mcp", server: LINEAR }),
    plan: async (change) => {
      changes.push(change)
      if (fail) throw new Error(fail)
      if (change.op === "delete") return { ...EMPTY_PLAN, commands: [{ argv: ["claude", "mcp", "remove", change.item!.name], touches: [] }] }
      const path = `/planned/${change.target.harness}/${change.target.scope}.json`
      return { ...EMPTY_PLAN, edits: [{ path, before: "", after: `${JSON.stringify(change.server)}\n` }], notices: ["Restart sessions."] }
    },
    memoryFiles: {},
    skillRoots: async () => [],
  }
}

function renderApp(fail?: string) {
  const adapters = [fakeAdapter("claude-code", "Claude Code", fail), fakeAdapter("codex", "Codex")]
  return testRender(<App adapters={adapters} roots={roots} backupRoot={join(home, "backups")} onQuit={() => {}} />, { width: 160, height: 40 })
}

type Setup = Awaited<ReturnType<typeof renderApp>>

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

async function openMcpTab(setup: Setup) {
  setup.mockInput.pressKey("3")
  await waitForText(setup, "Authorization = ••••••••") // detail pane of the selected server
}

// Renders after the tabs so that the newly focused input gets the next typed text.
async function pressTab(setup: Setup, times: number) {
  for (let count = 0; count < times; count++) setup.mockInput.pressTab()
  await setup.renderOnce()
}

test("add with two targets plans each and shows both in one review", async () => {
  const setup = await renderApp()
  try {
    await openMcpTab(setup)
    setup.mockInput.pressKey("a")
    await waitForText(setup, "WRITE TO")
    await setup.mockInput.typeText("github")
    await pressTab(setup, 2) // command
    await setup.mockInput.typeText("npx")
    pressTab(setup, 4) // name, transport, command, args, env, enabled → first target
    setup.mockInput.pressKey(" ")
    setup.mockInput.pressTab()
    setup.mockInput.pressKey(" ")
    setup.mockInput.pressEnter()
    const review = await waitForText(setup, "Review changes")
    expect(review).toContain("/planned/claude-code/global.json")
    expect(review).toContain("/planned/codex/global.json")
    expect(changes.map((change) => [change.op, change.target.harness, change.server?.name, change.server?.command])).toEqual([
      ["create", "claude-code", "github", "npx"],
      ["create", "codex", "github", "npx"],
    ])
  } finally {
    setup.renderer.destroy()
  }
})

test("edit fills the form from read() and offers only the item's harness", async () => {
  const setup = await renderApp()
  try {
    await openMcpTab(setup)
    setup.mockInput.pressKey("e")
    const form = await waitForText(setup, "WRITE TO")
    expect(form).toContain("https://mcp.linear.app/mcp")
    expect(form).toContain("Authorization=")
    expect(form).toContain("Claude Code")
    expect(form).not.toContain("Codex")
    setup.mockInput.pressEnter()
    await waitForText(setup, "Review changes")
    expect(changes[0]).toMatchObject({ op: "update", target: { harness: "claude-code", scope: "global" }, item: { name: "linear" }, server: { url: LINEAR.url } })
  } finally {
    setup.renderer.destroy()
  }
})

test("copy to… excludes the item's own harness and plans a create in the chosen one", async () => {
  const setup = await renderApp()
  try {
    await openMcpTab(setup)
    setup.mockInput.pressKey("c")
    const form = await waitForText(setup, "WRITE TO")
    expect(form).toContain("Codex")
    expect(form).not.toContain("Claude Code")
    pressTab(setup, 5) // name, transport, url, headers, enabled → Codex
    setup.mockInput.pressKey(" ")
    setup.mockInput.pressEnter()
    await waitForText(setup, "/planned/codex/global.json")
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ op: "create", target: { harness: "codex" }, server: { name: "linear", url: LINEAR.url } })
    expect(changes[0]!.server!.native).toEqual({})
  } finally {
    setup.renderer.destroy()
  }
})

test("space plans an update with enabled flipped", async () => {
  const setup = await renderApp()
  try {
    await openMcpTab(setup)
    setup.mockInput.pressKey(" ")
    await waitForText(setup, "Review changes")
    expect(changes[0]).toMatchObject({ op: "update", item: { name: "linear" }, server: { name: "linear", enabled: false } })
  } finally {
    setup.renderer.destroy()
  }
})

test("delete shows the planned command", async () => {
  const setup = await renderApp()
  try {
    await openMcpTab(setup)
    setup.mockInput.pressKey("d")
    const review = await waitForText(setup, "run command")
    expect(review).toContain("claude mcp remove linear")
    expect(changes[0]).toMatchObject({ kind: "mcp", op: "delete", item: { name: "linear" } })
  } finally {
    setup.renderer.destroy()
  }
})

test("a literal header secret is masked in review and shown after r", async () => {
  const setup = await renderApp()
  try {
    await openMcpTab(setup)
    setup.mockInput.pressKey(" ")
    const review = await waitForText(setup, "Review changes")
    expect(review).not.toContain("sk-live-123")
    expect(review).toContain('"Authorization":"••••••••"')
    setup.mockInput.pressKey("r")
    await waitForText(setup, "Bearer sk-live-123")
  } finally {
    setup.renderer.destroy()
  }
})

test("a plan error shows its message as one line", async () => {
  const setup = await renderApp("linear is managed by policy.")
  try {
    await openMcpTab(setup)
    setup.mockInput.pressKey("d")
    const frame = await waitForText(setup, "linear is managed by policy.")
    expect(frame).toContain("a add")
  } finally {
    setup.renderer.destroy()
  }
})

test("enter on an empty add form marks the name and the harnesses and plans nothing", async () => {
  const setup = await renderApp()
  try {
    await openMcpTab(setup)
    setup.mockInput.pressKey("a")
    await waitForText(setup, "WRITE TO")
    setup.mockInput.pressEnter()
    const frame = await waitForText(setup, "▲ Name is required")
    expect(frame).toContain("▲ Pick at least one harness")
    expect(changes).toEqual([])
  } finally {
    setup.renderer.destroy()
  }
})

test("a header that holds a literal value is marked in the form", async () => {
  const setup = await renderApp()
  try {
    await openMcpTab(setup)
    setup.mockInput.pressKey("e")
    const form = await waitForText(setup, "WRITE TO")
    expect(form).toMatch(/Headers +Authorization=Bearer sk-live-123 +▲ literal value/)
  } finally {
    setup.renderer.destroy()
  }
})

test("the edit form names the server and says the edit stays in its file", async () => {
  const setup = await renderApp()
  try {
    await openMcpTab(setup)
    setup.mockInput.pressKey("e")
    const form = await waitForText(setup, "WRITE TO")
    expect(form).toContain("Edit MCP server linear")
    expect(form).toContain("WRITE TO  an edit stays in its file")
  } finally {
    setup.renderer.destroy()
  }
})

test("? typed in a form field is text, not the help key", async () => {
  const setup = await renderApp()
  try {
    await openMcpTab(setup)
    setup.mockInput.pressKey("a")
    await waitForText(setup, "WRITE TO")
    await setup.mockInput.typeText("why?")
    const frame = await waitForText(setup, "why?")
    expect(frame).not.toContain("MOVE AROUND")
  } finally {
    setup.renderer.destroy()
  }
})

test("the space key label says whether it turns the selected server on or off", async () => {
  const setup = await renderApp()
  try {
    await openMcpTab(setup)
    const frame = await waitForText(setup, "space turn")
    expect(frame).toMatch(/space turn (on|off)\b(?!\/)/)
  } finally {
    setup.renderer.destroy()
  }
})

test("enter on an incomplete form says how many fields to fix", async () => {
  const setup = await renderApp()
  try {
    await openMcpTab(setup)
    setup.mockInput.pressKey("a")
    await waitForText(setup, "WRITE TO")
    setup.mockInput.pressEnter()
    await waitForText(setup, "Fix 2 fields to continue.")
  } finally {
    setup.renderer.destroy()
  }
})
