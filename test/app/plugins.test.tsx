import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { testRender } from "@opentui/react/test-utils"
import { EMPTY_PLAN } from "./fake-skills"
import type { Change, HarnessAdapter, HarnessId, Item, Roots, Scope } from "../../src/core/model"

const { App } = await import("../../src/app/App")

let home: string
let roots: Roots
let changes: Change[]
let github: Item

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "agent-manager-plugins-"))
  roots = { home, project: join(home, "repo"), env: {} }
  changes = []
  github = { kind: "plugin", harness: "claude-code", scope: "global", name: "github@official", path: join(home, ".claude/settings.json"), key: "enabledPlugins.github@official", loadedBy: ["claude-code"] }
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

// Claude Code knows one marketplace; Codex has none. plan() returns a command naming the change.
function fakeAdapter(id: HarnessId, label: string, fail?: string): HarnessAdapter {
  const scopes: Scope[] = id === "claude-code" ? ["global", "project", "local"] : ["global", "project"]
  const adapter: HarnessAdapter = {
    id,
    label,
    scopes,
    detect: async () => true,
    list: async (kind) => (kind === "plugin" && id === "claude-code" ? [github] : []),
    read: async () => ({ type: "plugin", plugin: { name: "github@official", enabled: true, version: "1.4.2", source: "official" } }),
    plan: async (change) => {
      changes.push(change)
      if (fail) throw new Error(fail)
      const subject = change.plugin?.name ?? change.marketplace ?? change.item?.name ?? ""
      return { ...EMPTY_PLAN, commands: [{ argv: ["plugin", change.op, subject], touches: [] }] }
    },
    memoryFiles: {},
    skillRoots: async () => [],
  }
  if (id === "claude-code") adapter.marketplaces = async () => [{ name: "official", source: "anthropics/claude-plugins-official" }]
  return adapter
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

async function openPluginTab(setup: Setup) {
  setup.mockInput.pressKey("4")
  await waitForText(setup, "space disable") // detail pane of the selected plugin
}

test("the status bar lists the plugin keys", async () => {
  const setup = await renderApp()
  try {
    await openPluginTab(setup)
    const frame = await waitForText(setup, "i install")
    expect(frame).toContain("i install  space on/off  u update  x uninstall  m marketplaces  s scope")
  } finally {
    setup.renderer.destroy()
  }
})

test("install asks harness, scope and name, hints marketplaces, and plans a create", async () => {
  const setup = await renderApp()
  try {
    await openPluginTab(setup)
    setup.mockInput.pressKey("i")
    await waitForText(setup, "Harness")
    setup.mockInput.pressEnter() // Claude Code
    await waitForText(setup, "Scope")
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressEnter() // project
    await waitForText(setup, "marketplaces: official")
    await setup.mockInput.typeText("ponytail@at")
    setup.mockInput.pressEnter()
    const review = await waitForText(setup, "nothing is written")
    expect(review).toContain("plugin create ponytail@at")
    expect(changes).toEqual([{ kind: "plugin", op: "create", target: { harness: "claude-code", scope: "project" }, plugin: { name: "ponytail@at", enabled: true } }])
  } finally {
    setup.renderer.destroy()
  }
})

test("space plans an update with enabled flipped", async () => {
  const setup = await renderApp()
  try {
    await openPluginTab(setup)
    setup.mockInput.pressKey(" ")
    await waitForText(setup, "nothing is written")
    expect(changes[0]).toMatchObject({ kind: "plugin", op: "update", item: { name: "github@official" }, plugin: { name: "github@official", enabled: false } })
  } finally {
    setup.renderer.destroy()
  }
})

test("u plans an update with enabled unchanged", async () => {
  const setup = await renderApp()
  try {
    await openPluginTab(setup)
    setup.mockInput.pressKey("u")
    await waitForText(setup, "nothing is written")
    expect(changes[0]).toMatchObject({ kind: "plugin", op: "update", item: { name: "github@official" }, plugin: { enabled: true, version: "1.4.2" } })
  } finally {
    setup.renderer.destroy()
  }
})

test("x plans a delete of the selected plugin", async () => {
  const setup = await renderApp()
  try {
    await openPluginTab(setup)
    setup.mockInput.pressKey("x")
    const review = await waitForText(setup, "run command")
    expect(review).toContain("plugin delete github@official")
    expect(changes[0]).toMatchObject({ kind: "plugin", op: "delete", target: { harness: "claude-code", scope: "global" }, item: { name: "github@official" } })
  } finally {
    setup.renderer.destroy()
  }
})

test("m lists marketplaces; a adds one from a source", async () => {
  const setup = await renderApp()
  try {
    await openPluginTab(setup)
    setup.mockInput.pressKey("m")
    const screen = await waitForText(setup, "anthropics/claude-plugins-official")
    expect(screen).toContain("official")
    setup.mockInput.pressKey("a")
    await waitForText(setup, "Harness")
    const harnesses = await waitForText(setup, "Claude Code")
    expect(harnesses).not.toContain("Codex")
    setup.mockInput.pressEnter()
    await waitForText(setup, "Source")
    await setup.mockInput.typeText("andytavares/plugins")
    setup.mockInput.pressEnter()
    await waitForText(setup, "nothing is written")
    expect(changes).toEqual([{ kind: "plugin", op: "create", target: { harness: "claude-code", scope: "global" }, marketplace: "andytavares/plugins" }])
  } finally {
    setup.renderer.destroy()
  }
})

test("d on the marketplace screen plans its removal; esc goes back", async () => {
  const setup = await renderApp()
  try {
    await openPluginTab(setup)
    setup.mockInput.pressKey("m")
    await waitForText(setup, "anthropics/claude-plugins-official")
    setup.mockInput.pressKey("d")
    await waitForText(setup, "plugin delete official")
    expect(changes).toEqual([{ kind: "plugin", op: "delete", target: { harness: "claude-code", scope: "global" }, marketplace: "official" }])
    setup.mockInput.pressEscape()
    await waitForText(setup, "i install")
  } finally {
    setup.renderer.destroy()
  }
})

test("a plan error shows its message as one line", async () => {
  const setup = await renderApp("OpenCode 1.x cannot turn a plugin off")
  try {
    await openPluginTab(setup)
    setup.mockInput.pressKey(" ")
    const frame = await waitForText(setup, "OpenCode 1.x cannot turn a plugin off")
    expect(frame).toContain("i install")
  } finally {
    setup.renderer.destroy()
  }
})
