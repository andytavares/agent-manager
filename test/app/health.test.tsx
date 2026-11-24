import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { testRender } from "@opentui/react/test-utils"
import type { HarnessAdapter, Roots } from "../../src/core/model"

const { App } = await import("../../src/app/App")

const INDEX = "- [Kept](project_kept.md) — a listed entry\n- [Gone](project_gone.md) — the file was deleted\n"
const KEPT = "---\nname: project-kept\ndescription: A listed entry\nmetadata:\n  type: project\n---\n\nListed.\n"
const ORPHAN = "---\nname: project-capex\ndescription: Check the capex plan\nmetadata:\n  type: project\n---\n\nNobody indexed me.\n"

let home: string
let roots: Roots
let memoryDir: string

// The app finds auto memory through the Claude Code config dir, so CLAUDE_CONFIG_DIR makes the test hermetic.
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "agent-manager-health-"))
  roots = { home, project: join(home, "repo"), env: { CLAUDE_CONFIG_DIR: join(home, ".claude") } }
  memoryDir = join(home, ".claude/projects", roots.project.replace(/[/.]/g, "-"), "memory")
  mkdirSync(memoryDir, { recursive: true })
  writeFileSync(join(memoryDir, "MEMORY.md"), INDEX)
  writeFileSync(join(memoryDir, "project_kept.md"), KEPT)
  writeFileSync(join(memoryDir, "project_capex.md"), ORPHAN)
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

const adapter: HarnessAdapter = {
  id: "claude-code",
  label: "Claude Code",
  scopes: ["global", "project"],
  detect: async () => true,
  list: async (kind) =>
    kind !== "memory"
      ? []
      : [join(memoryDir, "MEMORY.md"), join(memoryDir, "project_kept.md"), join(memoryDir, "project_capex.md")].map((path) => ({
          kind: "memory" as const,
          harness: "claude-code" as const,
          scope: "project" as const,
          name: path.slice(memoryDir.length + 1),
          path,
          loadedBy: ["claude-code" as const],
        })),
  read: async () => ({ type: "text", text: "" }),
  // The Health fix plans its own edit, so the adapter's plan is never used.
  plan: async () => ({ edits: [], moves: [], copies: [], removals: [], commands: [], notices: [] }),
  memoryFiles: {},
  skillRoots: async () => [],
}

type Setup = Awaited<ReturnType<typeof renderApp>>

function renderApp() {
  return testRender(<App adapters={[adapter]} roots={roots} backupRoot={join(home, "backups")} onQuit={() => {}} />, { width: 120, height: 34 })
}

// waitForFrame stops when no render is scheduled; file I/O can finish after that, so retry for up to 2s.
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

test("the Health tab shows its count in the tab row and each issue as a row", async () => {
  const setup = await renderApp()
  try {
    await waitForText(setup, "1 Memory")
    setup.mockInput.pressKey("5")
    const frame = await waitForText(setup, "2 issues")
    expect(frame).toContain("5 Health ▲2")
    expect(frame).toMatch(/AUTO MEMORY ─+ 2 /)
    expect(frame).toMatch(/project_capex is missing from MEMORY\.md\s+project_capex\.md\s+f add/)
    expect(frame).toMatch(/MEMORY\.md line 2 points to a missing file\s+MEMORY\.md · project_gone\.md\s+f drop/)
    expect(frame).toContain("▌ ")
    expect(frame).toContain("0 secrets · 2 warnings")
  } finally {
    setup.renderer.destroy()
  }
})

test("f on the orphan opens the review with the MEMORY.md index line added", async () => {
  const setup = await renderApp()
  try {
    await waitForText(setup, "1 Memory")
    setup.mockInput.pressKey("5")
    await waitForText(setup, "2 issues")
    setup.mockInput.pressArrow("down") // orphan, after the dead index line
    setup.mockInput.pressKey("f")
    const review = await waitForText(setup, "⏎ apply")
    expect(review).toContain("MEMORY.md")
    expect(review).toContain("[project-capex](project_capex.md) — Check the capex plan")
  } finally {
    setup.renderer.destroy()
  }
})

test("f on an orphan whose frontmatter is not valid YAML still opens the review", async () => {
  writeFileSync(join(memoryDir, "project_capex.md"), "---\nname: project-capex\ndescription: Where: the capex plan lives\n---\n\nBody.\n")
  const setup = await renderApp()
  try {
    await waitForText(setup, "1 Memory")
    setup.mockInput.pressKey("5")
    await waitForText(setup, "is missing from MEMORY.md")
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressKey("f")
    const review = await waitForText(setup, "⏎ apply")
    expect(review).toContain("[project-capex](project_capex.md) — Where: the capex plan lives")
  } finally {
    setup.renderer.destroy()
  }
})

test("the issue detail puts what the fix does in its first three lines", async () => {
  const { IssueDetail } = await import("../../src/app/Health")
  const issue = { kind: "orphan" as const, path: "/home/u/mem/code-owners.md", detail: "not listed in MEMORY.md" }
  const setup = await testRender(
    <box height={3} overflow="hidden">
      <IssueDetail issue={issue} home="/home/u" />
    </box>,
    { width: 100, height: 6 },
  )
  try {
    const frame = await setup.waitForFrame((f) => f.includes("Not in MEMORY.md"))
    expect(frame).toContain("f adds its line")
    expect(frame).toContain("You review it first")
  } finally {
    setup.renderer.destroy()
  }
})

const SKILL_ISSUE = { kind: "skill" as const, path: "/home/u/.claude/skills/quarterly-capex-review-assistant/SKILL.md", detail: "Claude Code: description is missing" }
const SECRET_ISSUE = { kind: "mcp-secret" as const, path: "/home/u/projects/finance-dashboard-service/.mcp.json", detail: "GITHUB_TOKEN is a literal value, use ${VAR}" }
const SKILL_PLACE = "~/.claude/skills/quarterly-capex-review-assistant"
const SECRET_PLACE = "~/projects/finance-dashboard-service/.mcp.json"

// A wrapped path breaks at "/" and "-", so each piece between them must show somewhere in the frame.
const missingSegments = (frame: string, path: string) => path.split(/[/-]/).filter((segment) => !frame.includes(segment))

test("issue rows show long skill and MCP config paths in full, wrapped instead of cut", async () => {
  const { Health, issueId } = await import("../../src/app/Health")
  const setup = await testRender(<Health issues={[SECRET_ISSUE, SKILL_ISSUE]} selectedId={issueId(SECRET_ISSUE)} layout={{ home: "/home/u", width: 118 }} />, { width: 120, height: 34 })
  try {
    const frame = await setup.waitForFrame((f) => f.includes("SKILLS"))
    expect(frame).not.toContain("…")
    expect(missingSegments(frame, SKILL_PLACE)).toEqual([])
    expect(missingSegments(frame, SECRET_PLACE)).toEqual([])
    expect(frame).toContain("f fix")
    expect(frame).toContain("e edit")
  } finally {
    setup.renderer.destroy()
  }
})

test("the detail strip wraps a config path wider than the strip instead of cutting it", async () => {
  const { IssueDetail } = await import("../../src/app/Health")
  const issue = { ...SECRET_ISSUE, path: "/home/u/projects/finance-dashboard-service/environments/production-eu-west/shared-configuration/overrides/.mcp.json" }
  const setup = await testRender(
    <box height={10} overflow="hidden">
      <IssueDetail issue={issue} home="/home/u" />
    </box>,
    { width: 100, height: 12 },
  )
  try {
    const frame = await setup.waitForFrame((f) => f.includes("Secret in config"))
    expect(missingSegments(frame, "~/projects/finance-dashboard-service/environments/production-eu-west/shared-configuration/overrides/.mcp.json")).toEqual([])
  } finally {
    setup.renderer.destroy()
  }
})
