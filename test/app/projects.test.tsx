import { afterEach, beforeEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { testRender } from "@opentui/react/test-utils"
import { EMPTY_PLAN } from "./fake-skills"
import type { HarnessAdapter, Roots } from "../../src/core/model"

const { App } = await import("../../src/app/App")
const { Projects } = await import("../../src/app/Projects")

let home: string
let roots: Roots
let otherData: string
let lostData: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "agent-manager-projects-"))
  roots = { home, project: join(home, "repo"), env: {} }
  otherData = join(home, ".claude/projects/-other")
  mkdirSync(join(otherData, "memory"), { recursive: true })
  writeFileSync(join(otherData, "memory/MEMORY.md"), "Remembered\n")
  lostData = join(home, ".claude/projects/-lost")
  mkdirSync(lostData, { recursive: true })
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

// Each project has one memory file named after its folder; the third project's folder is unknown.
// A project is listed while its data folder exists, except the current one, so a deletion shows.
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
    projects: async () =>
      [
        { path: join(home, "repo"), dataDir: join(home, ".claude/projects/-repo") },
        { path: join(home, "other"), dataDir: otherData },
        { dataDir: lostData },
      ].filter((project) => project.path === join(home, "repo") || existsSync(project.dataDir)),
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
  setup.mockInput.pressKey("p")
  await waitForText(setup, "folder unknown")
}

test("s lists every project; enter on another project shows its items", async () => {
  const setup = await renderApp()
  try {
    await openProjects(setup)
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressEnter()
    const frame = await waitForText(setup, "other-notes.md")
    expect(frame).toContain("~/other")
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
    expect(frame).toContain("~/repo")
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
    const after = await waitForText(setup, "Saved")
    expect(existsSync(otherData)).toBe(false)
    expect(existsSync(join(home, "backups"))).toBe(true)
    expect(after).toContain("Projects") // back on the project list, refreshed
    expect(after).not.toContain("~/other")
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

test("space marks several projects and d deletes them in one review", async () => {
  const setup = await renderApp()
  try {
    await openProjects(setup)
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressKey(" ")
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressKey(" ")
    const marked = await waitForText(setup, "2 marked")
    expect(marked).toContain("●  ~/other")
    expect(marked).toContain("●  -lost")
    setup.mockInput.pressKey("d")
    const review = await waitForText(setup, "Review changes")
    expect(review).toContain("~/.claude/projects/-other")
    expect(review).toContain("~/.claude/projects/-lost")
    setup.mockInput.pressEnter()
    const after = await waitForText(setup, "Saved")
    expect(existsSync(otherData)).toBe(false)
    expect(existsSync(lostData)).toBe(false)
    expect(after).toContain("Projects")
  } finally {
    setup.renderer.destroy()
  }
})

test("space on a marked project unmarks it", async () => {
  const setup = await renderApp()
  try {
    await openProjects(setup)
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressKey(" ")
    await waitForText(setup, "1 marked")
    setup.mockInput.pressKey(" ")
    const frame = await waitForText(setup, "▌    ~/other")
    expect(frame).not.toContain("1 marked")
  } finally {
    setup.renderer.destroy()
  }
})

test("esc on the review goes back to the project list", async () => {
  const setup = await renderApp()
  try {
    await openProjects(setup)
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressKey("d")
    await waitForText(setup, "moved to backup")
    setup.mockInput.pressEscape()
    await waitForText(setup, "folder unknown")
    expect(existsSync(otherData)).toBe(true)
  } finally {
    setup.renderer.destroy()
  }
})

test("a project whose folder is unknown says so, and the title counts projects and marks", async () => {
  const setup = await renderApp()
  try {
    await openProjects(setup)
    const frame = await waitForText(setup, "3 projects · 0 marked")
    expect(frame).toContain("Claude Code data folders are in ~/.claude/projects/")
    expect(frame).toMatch(/-lost +-lost +folder unknown/)
    expect(frame).toMatch(/~\/repo +-repo +● current/)
    setup.mockInput.pressKey(" ")
    await waitForText(setup, "3 projects · 1 marked")
  } finally {
    setup.renderer.destroy()
  }
})

const LONG_FOLDER = "-Users-dev-repos-customer-billing-reconciliation-service"
const longProject = { path: "/Users/dev/repos/customer-billing-reconciliation-service", dataDir: `/Users/dev/.claude/projects/${LONG_FOLDER}` }

// The text of the highlighted row's CLAUDE CODE DATA cell, read down its column across the wrapped lines.
function folderInDataColumn(frame: string): string {
  const lines = frame.split("\n")
  const column = lines.find((line) => line.includes("PROJECT"))?.indexOf("CLAUDE") ?? 0
  const rowLines = lines.filter((line) => line.includes("▌"))
  return rowLines.map((line) => line.slice(column).match(/^[^\s│]*/)![0]).join("")
}

function renderProjects(projects: { path?: string; dataDir: string }[], size: { width: number; height: number }) {
  return testRender(<Projects projects={projects} current={longProject.path} home="/Users/dev" onOpen={() => {}} onDelete={() => {}} onBack={() => {}} />, size)
}

test("a wide terminal shows a long data folder name on one line, and the footer shows its absolute path", async () => {
  const setup = await renderProjects([longProject], { width: 160, height: 40 })
  try {
    const frame = await setup.waitForFrame((f) => f.includes("Projects"))
    expect(frame).toContain(LONG_FOLDER)
    expect(frame).toContain(`data  ${longProject.dataDir}`)
  } finally {
    setup.renderer.destroy()
  }
})

test("a narrow terminal wraps the data folder name inside its column and cuts nothing", async () => {
  const setup = await renderProjects([longProject], { width: 80, height: 30 })
  try {
    const frame = await setup.waitForFrame((f) => folderInDataColumn(f) === LONG_FOLDER)
    expect(folderInDataColumn(frame)).toBe(LONG_FOLDER)
    expect(frame).not.toContain("…")
  } finally {
    setup.renderer.destroy()
  }
})

test("a list taller than the terminal scrolls so the highlighted last project shows", async () => {
  const projects = Array.from({ length: 40 }, (_, index) => {
    const name = `project-${String(index + 1).padStart(2, "0")}`
    return { path: `/Users/dev/repos/${name}`, dataDir: `/Users/dev/.claude/projects/-Users-dev-repos-${name}` }
  })
  const setup = await renderProjects(projects, { width: 80, height: 24 })
  try {
    await setup.waitForFrame((f) => f.includes("~/repos/project-01"))
    Array.from({ length: 39 }).forEach(() => setup.mockInput.pressArrow("down"))
    const frame = await setup.waitForFrame((f) => f.includes("project-40"))
    expect(frame).toContain("~/repos/project-40")
  } finally {
    setup.renderer.destroy()
  }
})
