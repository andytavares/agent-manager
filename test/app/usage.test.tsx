import { expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { App } from "../../src/app/App"
import type { HarnessAdapter, HarnessId, Item, Roots } from "../../src/core/model"

const roots: Roots = { home: "/home/u", project: "/home/u/repo", env: {} }

const items: Item[] = [
  { kind: "mcp", harness: "claude-code", scope: "global", name: "github", path: "/home/u/.claude.json", key: "mcpServers.github", loadedBy: ["claude-code"] },
  { kind: "mcp", harness: "codex", scope: "global", name: "docs", path: "/home/u/.codex/config.toml", key: "mcp_servers.docs", loadedBy: ["codex"] },
]

function fakeAdapter(id: HarnessId, label: string): HarnessAdapter {
  return {
    id,
    label,
    scopes: ["global", "project"],
    detect: async () => true,
    list: async (kind) => items.filter((item) => item.kind === kind && item.harness === id),
    read: async () => ({ type: "text", text: "" }),
    plan: async () => ({ edits: [], moves: [], copies: [], removals: [], commands: [], notices: [] }),
    memoryFiles: {},
    skillRoots: async () => [],
  }
}

const adapters = [fakeAdapter("claude-code", "Claude Code"), fakeAdapter("codex", "Codex")]

type Setup = Awaited<ReturnType<typeof testRender>>

// The list is filled by async effects; the first frame can take more than one poll.
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

test("the MCP tab shows the here and last used columns and marks a Claude Code server loaded", async () => {
  const setup = await testRender(<App adapters={adapters} roots={roots} onQuit={() => {}} />, { width: 120, height: 34 })
  try {
    await waitForText(setup, "GLOBAL")
    setup.mockInput.pressKey("3")
    const frame = await waitForText(setup, "github")
    expect(frame).toMatch(/SERVER\s+TYPE\s+DEFINED IN\s+CC\s+Cx\s+here\s+last used\s+NOTE/)
    expect(frame).toMatch(/github\s+~\/\.claude\.json\s+✓/)
  } finally {
    setup.renderer.destroy()
  }
})
