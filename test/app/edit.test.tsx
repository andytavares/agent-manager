import { afterEach, beforeEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { testRender } from "@opentui/react/test-utils"
import { EMPTY_PLAN, fakeSkills } from "./fake-skills"
import type { Change, HarnessAdapter, HarnessId, Item, Roots } from "../../src/core/model"

const { App } = await import("../../src/app/App")

let home: string
let roots: Roots
let memoryPath: string
let changes: Change[]

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "agent-manager-edit-"))
  roots = { home, project: join(home, "repo"), env: {} }
  memoryPath = join(home, ".claude/CLAUDE.md")
  mkdirSync(dirname(memoryPath), { recursive: true })
  writeFileSync(memoryPath, "Be brief.\n")
  changes = []
  listed["claude-code memory"] = [memoryItem()]
  listed["codex skill"] = [skillItem()]
  listed["claude-code skill"] = [
    { kind: "skill", harness: "claude-code", scope: "global", name: "research", path: join(home, ".claude/skills/research"), loadedBy: ["claude-code"] },
  ]
})

afterEach(() => {
  fakeSkills.planSkill = undefined
  fakeSkills.skillChecks = undefined
  rmSync(home, { recursive: true, force: true })
})

function memoryItem(): Item {
  return { kind: "memory", harness: "claude-code", scope: "global", name: "CLAUDE.md", path: memoryPath, loadedBy: ["claude-code"] }
}

function skillItem(): Item {
  const path = join(home, ".codex/skills/pdf")
  return { kind: "skill", harness: "codex", scope: "global", name: "pdf", path, loadedBy: [], warnings: ["* likely not loaded"] }
}

const listed: Record<string, Item[]> = {}

// Plans memory changes as real edits so that applyPlan can write them.
interface FakeOptions {
  memoryFiles: string[]
  skillRoot: string
  fail?: string // message plan() throws
}

function fakeAdapter(id: HarnessId, label: string, { memoryFiles, skillRoot, fail }: FakeOptions): HarnessAdapter {
  return {
    id,
    label,
    scopes: ["global", "project"],
    detect: async () => true,
    list: async (kind) => listed[`${id} ${kind}`] ?? [],
    read: async (item) => ({ type: "text", text: existsSync(item.path) ? readFileSync(item.path, "utf8") : "" }),
    plan: async (change) => {
      changes.push(change)
      if (fail) throw new Error(fail)
      if (change.op === "delete") return { ...EMPTY_PLAN, removals: [change.item!.path] }
      const path = change.item?.path ?? join(home, change.name!)
      const before = existsSync(path) ? readFileSync(path, "utf8") : null
      return { ...EMPTY_PLAN, edits: [{ path, before, after: change.text! }], notices: ["Restart Claude Code sessions to load this change."] }
    },
    memoryFiles: { global: memoryFiles },
    skillRoots: async () => [{ path: join(home, skillRoot), scope: "global" }],
  }
}

function renderApp(fail?: string) {
  const adapters = [
    fakeAdapter("claude-code", "Claude Code", { memoryFiles: ["CLAUDE.md", "memory/<name>.md"], skillRoot: ".claude/skills", fail }),
    fakeAdapter("codex", "Codex", { memoryFiles: ["AGENTS.md", "rules/<name>.md"], skillRoot: ".agents/skills" }),
  ]
  const backupRoot = join(home, "backups")
  return testRender(<App adapters={adapters} roots={roots} backupRoot={backupRoot} onQuit={() => {}} />, { width: 120, height: 30 })
}

type Setup = Awaited<ReturnType<typeof renderApp>>

// waitForFrame stops when no render is scheduled; real file I/O can finish after that, so retry for up to 2s.
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

async function editAndSave(setup: Setup) {
  await waitForText(setup, "Be brief.")
  setup.mockInput.pressKey("e")
  await waitForText(setup, "ctrl+s")
  await setup.mockInput.typeText("Use tabs. ")
  setup.mockInput.pressKey("s", { ctrl: true })
  return waitForText(setup, "Review changes")
}

test("edit memory, ctrl+s shows the diff, esc writes nothing", async () => {
  const setup = await renderApp()
  try {
    const review = await editAndSave(setup)
    expect(review).toContain("Use tabs. Be brief.")
    expect(review).toContain("Backup: ")
    setup.mockInput.pressEscape()
    await waitForText(setup, "a add")
    expect(readFileSync(memoryPath, "utf8")).toBe("Be brief.\n")
    expect(existsSync(join(home, "backups"))).toBe(false)
  } finally {
    setup.renderer.destroy()
  }
})

test("enter on review writes the file through applyPlan and shows the backup and notices", async () => {
  const setup = await renderApp()
  try {
    await editAndSave(setup)
    setup.mockInput.pressEnter()
    const frame = await waitForText(setup, "Saved.")
    expect(frame).toContain("Restart Claude Code sessions")
    expect(readFileSync(memoryPath, "utf8")).toBe("Use tabs. Be brief.\n")
    expect(frame).toContain("backups")
    expect(frame).toContain("a add")
  } finally {
    setup.renderer.destroy()
  }
})

test("a file changed after planning shows the stale file message and is not written", async () => {
  const setup = await renderApp()
  try {
    await editAndSave(setup)
    writeFileSync(memoryPath, "Edited elsewhere.\n")
    setup.mockInput.pressEnter()
    await waitForText(setup, "Reload and try again.")
    expect(readFileSync(memoryPath, "utf8")).toBe("Edited elsewhere.\n")
  } finally {
    setup.renderer.destroy()
  }
})

test("add memory plans a create of the chosen file with the filled-in name", async () => {
  const setup = await renderApp()
  try {
    await waitForText(setup, "Be brief.")
    setup.mockInput.pressKey("a")
    await waitForText(setup, "Which harness should load it?")
    setup.mockInput.pressArrow("down") // Codex
    setup.mockInput.pressEnter()
    await waitForText(setup, "Which file?")
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressEnter()
    await waitForText(setup, "What is it called?")
    await setup.mockInput.typeText("style")
    setup.mockInput.pressEnter()
    await waitForText(setup, "ctrl+s")
    await setup.mockInput.typeText("Prefer tabs.")
    setup.mockInput.pressKey("s", { ctrl: true })
    const review = await waitForText(setup, "new file")
    expect(review).toContain("Prefer tabs.")
    expect(changes).toEqual([{ kind: "memory", op: "create", target: { harness: "codex", scope: "global" }, name: "rules/style.md", text: "Prefer tabs." }])
  } finally {
    setup.renderer.destroy()
  }
})

test("an auto memory entry asks for its type and description and starts with that frontmatter", async () => {
  const setup = await renderApp()
  try {
    await waitForText(setup, "Be brief.")
    setup.mockInput.pressKey("a")
    await waitForText(setup, "Which harness should load it?")
    setup.mockInput.pressEnter() // Claude Code
    await waitForText(setup, "Which file?")
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressEnter()
    await waitForText(setup, "What is it called?")
    await setup.mockInput.typeText("no-checkins")
    setup.mockInput.pressEnter()
    await waitForText(setup, "Which type of memory?")
    setup.mockInput.pressArrow("down") // feedback
    setup.mockInput.pressEnter()
    await waitForText(setup, "Describe it in one line.")
    await setup.mockInput.typeText("Finish the task")
    setup.mockInput.pressEnter()
    await waitForText(setup, "ctrl+s")
    setup.mockInput.pressKey("s", { ctrl: true })
    await waitForText(setup, "new file")
    expect(changes[0]).toMatchObject({ name: "memory/no-checkins.md" })
    expect(changes[0]!.text).toBe("---\nname: no-checkins\ndescription: Finish the task\nmetadata:\n  type: feedback\n---\n\n")
  } finally {
    setup.renderer.destroy()
  }
})

test("delete shows the removal in review", async () => {
  const setup = await renderApp()
  try {
    await waitForText(setup, "Be brief.")
    setup.mockInput.pressKey("d")
    const review = await waitForText(setup, "moved to backup")
    expect(review).toContain("~/.claude/CLAUDE.md")
    expect(changes[0]).toMatchObject({ op: "delete", item: { path: memoryPath } })
  } finally {
    setup.renderer.destroy()
  }
})

test("a plan error shows its message as one line", async () => {
  const setup = await renderApp("CLAUDE.md is managed by policy.")
  try {
    await waitForText(setup, "Be brief.")
    setup.mockInput.pressKey("d")
    const frame = await waitForText(setup, "CLAUDE.md is managed by policy.")
    expect(frame).toContain("a add")
  } finally {
    setup.renderer.destroy()
  }
})

test("m on a flagged skill plans a move to the chosen root", async () => {
  let planned: { change: Change; readers: HarnessId[] } | undefined
  fakeSkills.planSkill = async (change, readers) => {
    planned = { change, readers }
    return { ...EMPTY_PLAN, moves: [{ from: change.item!.path, to: join(change.destination!, "pdf") }] }
  }
  const setup = await renderApp()
  try {
    setup.mockInput.pressKey("2")
    await waitForText(setup, "likely not loaded")
    setup.mockInput.pressKey("m")
    await waitForText(setup, "~/.agents/skills")
    setup.mockInput.pressArrow("down") // ~/.agents/skills, after ~/.claude/skills
    setup.mockInput.pressEnter()
    const review = await waitForText(setup, "Review changes")
    expect(review).toContain("~/.agents/skills/pdf")
    expect(planned?.change).toMatchObject({ kind: "skill", op: "move", destination: join(home, ".agents/skills") })
    expect(planned?.readers).toEqual(["codex"])
  } finally {
    setup.renderer.destroy()
  }
})

test("the detail pane lists skill checks per harness that loads the skill", async () => {
  fakeSkills.skillChecks = (_, folderName) => [`${folderName} ok`]
  const setup = await renderApp()
  try {
    setup.mockInput.pressKey("2")
    await waitForText(setup, "likely not loaded")
    setup.mockInput.pressArrow("down") // research
    expect(await waitForText(setup, "Claude Code: research ok")).not.toContain("Codex: research ok")
  } finally {
    setup.renderer.destroy()
  }
})

test("add memory opens at step 1 of 5 and names every step", async () => {
  const setup = await renderApp()
  try {
    await waitForText(setup, "Be brief.")
    setup.mockInput.pressKey("a")
    const frame = await waitForText(setup, "Step 1 of 5")
    expect(frame).toContain("● Harness  ○ File  ○ Name  ○ Type  ○ Description")
    expect(frame).toContain("Which harness should load it?")
  } finally {
    setup.renderer.destroy()
  }
})

test("the next wizard step lists the earlier answer by its name and marks the step done", async () => {
  const setup = await renderApp()
  try {
    await waitForText(setup, "Be brief.")
    setup.mockInput.pressKey("a")
    await waitForText(setup, "Step 1 of 5")
    setup.mockInput.pressArrow("down") // Codex
    setup.mockInput.pressEnter()
    const frame = await waitForText(setup, "Step 2 of 5")
    expect(frame).toMatch(/Harness +Codex/)
    expect(frame).toContain("✓ Harness  ● File")
  } finally {
    setup.renderer.destroy()
  }
})

test("the editor numbers each line and marks the text modified once it differs", async () => {
  const setup = await renderApp()
  try {
    await waitForText(setup, "Be brief.")
    setup.mockInput.pressKey("e")
    const before = await waitForText(setup, "ctrl+s")
    expect(before).toMatch(/1 +Be brief\./)
    expect(before).not.toContain("● modified")
    await setup.mockInput.typeText("Use tabs. ")
    await waitForText(setup, "● modified")
  } finally {
    setup.renderer.destroy()
  }
})

test("the editor shows the cursor line, column and line count", async () => {
  const setup = await renderApp()
  try {
    await waitForText(setup, "Be brief.")
    setup.mockInput.pressKey("e")
    await waitForText(setup, "line 1, col 1 · 2 lines")
    await setup.mockInput.typeText("Use ")
    await waitForText(setup, "line 1, col 5 · 2 lines")
  } finally {
    setup.renderer.destroy()
  }
})

test("m on a plugin skill names the move and says it makes a copy you own", async () => {
  listed["codex skill"] = [{ ...skillItem(), readOnly: "from plugin alpha@mkt" }]
  const setup = await renderApp()
  try {
    setup.mockInput.pressKey("2")
    await waitForText(setup, "pdf")
    setup.mockInput.pressKey("m")
    const frame = await waitForText(setup, "Move skill pdf")
    expect(frame).toContain("Step 1 of 1")
    expect(frame).toContain("pdf comes from plugin alpha@mkt. Moving it makes a copy you own.")
  } finally {
    setup.renderer.destroy()
  }
})
