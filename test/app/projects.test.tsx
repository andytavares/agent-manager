import { afterEach, beforeEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { testRender } from "@opentui/react/test-utils"
import { EMPTY_PLAN } from "./fake-skills"
import type { HarnessAdapter, Roots } from "../../src/core/model"

const { App } = await import("../../src/app/App")

let home: string
let roots: Roots
let otherData: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "agent-manager-projects-"))
  roots = { home, project: join(home, "repo"), env: {} }
  otherData = join(home, ".claude/projects/-other")
  mkdirSync(join(otherData, "memory"), { recursive: true })
  writeFileSync(join(otherData, "memory/MEMORY.md"), "Remembered\n")
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

// Each project has one memory file named after its folder; the third project's folder is unknown.
function fakeAdapter(): HarnessAdapter {
  return {
    id: "claude-code",
    label: "Claude Code",
    scopes: ["global", "project", "local"],
    detect: async () => true,
    list: async (kind, current) => {
      const name = `${basename(current.project)}-notes.md`
      return kind === "memory" ? [{ kind, harness: "claude-code", scope: "project", name, path: join(current.project, name), loadedBy: ["claude-code"] }] : []
    },
    read: async () => ({ type: "text", text: "" }),
    plan: async () => EMPTY_PLAN,
    memoryFiles: {},
    skillRoots: async () => [],
    projects: async () => [
      { path: join(home, "repo"), dataDir: join(home, ".claude/projects/-repo") },
      { path: join(home, "other"), dataDir: otherData },
      { dataDir: join(home, ".claude/projects/-lost") },
    ],
  }
}

function renderApp() {
  return testRender(<App adapters={[fakeAdapter()]} roots={roots} backupRoot={join(home, "backups")} onQuit={() => {}} />, { width: 160, height: 40 })
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

async function openProjects(setup: Setup) {
  await waitForText(setup, "● Claude Code") // the picker lists projects of detected harnesses only
  setup.mockInput.pressKey("s")
  await waitForText(setup, ".claude/projects/-lost")
}

test("s lists every project; enter on another project shows its items", async () => {
  const setup = await renderApp()
  try {
    await openProjects(setup)
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressEnter()
    const frame = await waitForText(setup, "other-notes.md")
    expect(frame).toContain("project: ~/other")
  } finally {
    setup.renderer.destroy()
  }
})

test("esc keeps the current project in project scope", async () => {
  const setup = await renderApp()
  try {
    await openProjects(setup)
    setup.mockInput.pressEscape()
    const frame = await waitForText(setup, "repo-notes.md")
    expect(frame).toContain("project: ~/repo")
  } finally {
    setup.renderer.destroy()
  }
})

test("d moves the project's data folder into the backup", async () => {
  const setup = await renderApp()
  try {
    await openProjects(setup)
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressKey("d")
    const review = await waitForText(setup, "moved to backup")
    expect(review).toContain("~/.claude/projects/-other")
    setup.mockInput.pressEnter()
    await waitForText(setup, "Saved")
    expect(existsSync(otherData)).toBe(false)
    expect(existsSync(join(home, "backups"))).toBe(true)
  } finally {
    setup.renderer.destroy()
  }
})

test("a project whose folder is unknown cannot be opened", async () => {
  const setup = await renderApp()
  try {
    await openProjects(setup)
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressEnter()
    await waitForText(setup, "Cannot open -lost: its project folder is unknown.")
  } finally {
    setup.renderer.destroy()
  }
})
