import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { testRender } from "@opentui/react/test-utils"
import { App } from "../../src/app/App"
import { HARNESS_LABELS, type Change, type HarnessAdapter, type HarnessId, type Item, type Roots } from "../../src/core/model"

type Setup = Awaited<ReturnType<typeof testRender>>

const roots: Roots = { home: "/home/u", project: "/home/u/repo", env: {} }

function fakeAdapter(id: HarnessId, items: Item[], changes: Change[] = []): HarnessAdapter {
  return {
    id,
    label: HARNESS_LABELS[id],
    scopes: ["global", "project"],
    detect: async () => true,
    list: async (kind) => items.filter((item) => item.kind === kind && item.harness === id),
    read: async (item) => ({ type: "text", text: `text of ${item.name}` }),
    plan: async (change) => {
      changes.push(change)
      return { edits: [], moves: [], copies: [], removals: [], commands: [], notices: [] }
    },
    memoryFiles: { global: [id === "codex" ? "AGENTS.md" : "CLAUDE.md"] },
    skillRoots: async () => [],
  }
}

const memory = (name: string, scope: Item["scope"], path: string): Item => ({ kind: "memory", harness: "claude-code", scope, name, path, loadedBy: ["claude-code"] })

// Key presses reach React state a little later, so retry the frame check.
async function waitFor(setup: Setup, predicate: (frame: string) => boolean): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await setup.waitForFrame(predicate)
    } catch (error) {
      if (attempt === 200) throw error
      await Bun.sleep(10)
    }
  }
}

const waitForText = (setup: Setup, text: string) => waitFor(setup, (frame) => frame.includes(text))
const waitForMatch = (setup: Setup, pattern: RegExp) => waitFor(setup, (frame) => pattern.test(frame))

// A temp home whose Claude Code config holds one project's auto memory folder with two entries and an index.
function autoMemoryHome(): { home: string; roots: Roots; memoryDir: string } {
  const home = mkdtempSync(join(tmpdir(), "screen-layout-"))
  const project = join(home, "repo")
  const memoryDir = join(home, ".claude", "projects", project.replace(/[/.]/g, "-"), "memory")
  mkdirSync(memoryDir, { recursive: true })
  writeFileSync(join(memoryDir, "MEMORY.md"), "- [Prefers bun](prefers-bun.md) — use bun\n- [Code owners](code-owners.md) — who owns what\n")
  writeFileSync(join(memoryDir, "prefers-bun.md"), "---\nname: prefers-bun\ndescription: use bun\nmetadata:\n  type: feedback\n---\n\nUse bun.\n")
  writeFileSync(join(memoryDir, "code-owners.md"), "---\nname: code-owners\ndescription: who owns what\nmetadata:\n  type: reference\n---\n\nOwners.\n")
  return { home, roots: { home, project, env: {} }, memoryDir }
}

async function renderAutoMemory(width: number, height: number) {
  const { home, roots: autoRoots, memoryDir } = autoMemoryHome()
  const items = [
    memory("CLAUDE.md", "global", join(home, ".claude", "CLAUDE.md")),
    memory("CLAUDE.md", "project", join(autoRoots.project, "CLAUDE.md")),
    memory("MEMORY.md", "project", join(memoryDir, "MEMORY.md")),
  ]
  const setup = await testRender(<App adapters={[fakeAdapter("claude-code", items)]} roots={autoRoots} onQuit={() => {}} />, { width, height })
  return { setup, cleanup: () => { setup.renderer.destroy(); rmSync(home, { recursive: true, force: true }) } }
}

test("the highlighted Memory row is the item the detail strip shows, in group order rather than name order", async () => {
  const items = [memory("zeta.md", "global", "/home/u/.claude/zeta.md"), memory("alpha.md", "project", "/home/u/repo/alpha.md")]
  const setup = await testRender(<App adapters={[fakeAdapter("claude-code", items)]} roots={roots} onQuit={() => {}} />, { width: 120, height: 34 })
  try {
    const first = await waitForText(setup, "alpha.md")
    expect(first).toMatch(/▌ zeta\.md/)
    expect(first).toMatch(/zeta\.md\s+Claude Code · global/)

    setup.mockInput.pressArrow("down")
    const second = await waitForMatch(setup, /▌ alpha\.md/)
    expect(second).toMatch(/alpha\.md\s+Claude Code · project/)
  } finally {
    setup.renderer.destroy()
  }
})

test("d on the first Memory row plans the delete of that row's item", async () => {
  const changes: Change[] = []
  const items = [memory("zeta.md", "global", "/home/u/.claude/zeta.md"), memory("alpha.md", "project", "/home/u/repo/alpha.md")]
  const setup = await testRender(<App adapters={[fakeAdapter("claude-code", items, changes)]} roots={roots} onQuit={() => {}} />, { width: 120, height: 34 })
  try {
    await waitForText(setup, "alpha.md")
    setup.mockInput.pressKey("d")
    await waitForText(setup, "apply")
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ op: "delete", item: { name: "zeta.md" } })
  } finally {
    setup.renderer.destroy()
  }
})

test("a list longer than the panel scrolls so the selected last row stays in view", async () => {
  const items = Array.from({ length: 30 }, (_, n) => memory(`file${String(n).padStart(2, "0")}.md`, "global", `/home/u/.claude/rules/file${n}.md`))
  const setup = await testRender(<App adapters={[fakeAdapter("claude-code", items)]} roots={roots} onQuit={() => {}} />, { width: 120, height: 34 })
  try {
    await waitForText(setup, "file00.md")
    for (let n = 0; n < 29; n++) setup.mockInput.pressArrow("down")
    const frame = await waitForMatch(setup, /▌ file29\.md/)
    expect(frame).toContain("row 30 of 30")
  } finally {
    setup.renderer.destroy()
  }
})

test("an auto memory file listed as a project item shows only under AUTO MEMORY, which ends with the MEMORY.md budget", async () => {
  const { setup, cleanup } = await renderAutoMemory(120, 34)
  try {
    const frame = await waitForText(setup, "Prefers bun")
    expect(frame).toContain("2 files · 2 entries")
    expect(frame).toMatch(/PROJECT .*─ 1 file /)
    expect(frame).toMatch(/AUTO MEMORY .*─ 2 entries /)
    const lines = frame.split("\n")
    const budget = lines.findIndex((line) => line.includes("MEMORY.md  █"))
    expect(budget).toBeGreaterThan(lines.findIndex((line) => line.includes("Code owners")))
    expect(lines.filter((line) => /\bMEMORY\.md\b/.test(line) && !line.includes("█"))).toEqual([])
  } finally {
    cleanup()
  }
})

test("the filter shows in the panel title with the match count, and an empty group says nothing matches", async () => {
  const { setup, cleanup } = await renderAutoMemory(120, 34)
  try {
    await waitForText(setup, "Prefers bun")
    await setup.mockInput.typeText("/clau")
    const frame = await waitForText(setup, "/ clau▌ · 2 of 4")
    expect(frame).toMatch(/GLOBAL .*─ 1 of 1 /)
    expect(frame).toMatch(/AUTO MEMORY .*─ 0 of 2 /)
    expect(frame).toContain("No entry matches “clau”.")
    expect(frame).not.toContain("Prefers bun")
  } finally {
    cleanup()
  }
})

test("the Memory key bar shows the tab's keys, then the shell keys, and the row position", async () => {
  const { setup, cleanup } = await renderAutoMemory(120, 34)
  try {
    const frame = await waitForText(setup, "Prefers bun")
    const bar = frame.split("\n").filter((line) => line.trim() !== "").at(-1)!
    expect(bar).toMatch(/a add {2}e edit {2}d delete .*\/ filter {2}u undo {2}\? all keys/)
    expect(bar).toContain("row 1 of 4")
  } finally {
    cleanup()
  }
})

test.each([[80, 24], [100, 34], [120, 34]])("no line is wider than a %i-column terminal", async (width, height) => {
  const { setup, cleanup } = await renderAutoMemory(width, height)
  try {
    const frame = await waitForText(setup, "Prefers bun")
    expect(frame.split("\n").filter((line) => [...line].length > width)).toEqual([])
  } finally {
    cleanup()
  }
})

test("under 100 columns the Harnesses panel folds away and the header keeps the harness filter", async () => {
  const { setup, cleanup } = await renderAutoMemory(80, 24)
  try {
    const frame = await waitForText(setup, "Prefers bun")
    expect(frame).not.toContain("Harnesses")
    expect(frame).toContain("All harnesses")
  } finally {
    cleanup()
  }
})

test("? opens the grouped key help and any key closes it", async () => {
  const setup = await testRender(<App adapters={[fakeAdapter("claude-code", [memory("CLAUDE.md", "global", "/home/u/.claude/CLAUDE.md")])]} roots={roots} onQuit={() => {}} />, { width: 120, height: 34 })
  try {
    await waitForText(setup, "CLAUDE.md")
    setup.mockInput.pressKey("?")
    const help = await waitForText(setup, "MOVE AROUND")
    expect(help).toContain("PLUGINS")
    expect(help).toContain("s next harness")
    setup.mockInput.pressKey("x")
    const closed = await waitFor(setup, (f) => !f.includes("MOVE AROUND"))
    expect(closed).toContain("CLAUDE.md")
  } finally {
    setup.renderer.destroy()
  }
})

test("help over a half-done prompt keeps the prompt, and keys pressed while it is open do not reach the prompt", async () => {
  const items = [memory("CLAUDE.md", "global", "/home/u/.claude/CLAUDE.md")]
  const adapters = [fakeAdapter("claude-code", items), fakeAdapter("codex", [])]
  const setup = await testRender(<App adapters={adapters} roots={roots} onQuit={() => {}} />, { width: 120, height: 34 })
  try {
    await waitForText(setup, "CLAUDE.md")
    setup.mockInput.pressKey("a")
    await waitForText(setup, "Add memory")
    setup.mockInput.pressKey("?")
    await waitForText(setup, "MOVE AROUND")
    setup.mockInput.pressArrow("down")
    const closed = await waitFor(setup, (f) => !f.includes("MOVE AROUND") && f.includes("Add memory"))
    expect(closed).toMatch(/▌ Claude Code/)
    setup.mockInput.pressEnter()
    const file = await waitForText(setup, "Step 2 of")
    expect(file).not.toContain("AGENTS.md")
  } finally {
    setup.renderer.destroy()
  }
})
