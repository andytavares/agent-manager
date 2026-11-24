import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { testRender } from "@opentui/react/test-utils"
import type { HarnessAdapter, Roots } from "../../src/core/model"

const { App } = await import("../../src/app/App")

let home: string
let roots: Roots
let backupRoot: string
let file: string

const adapter: HarnessAdapter = {
  id: "claude-code",
  label: "Claude Code",
  scopes: ["global", "project"],
  detect: async () => true,
  list: async () => [],
  read: async () => ({ type: "text", text: "" }),
  plan: async () => ({ edits: [], moves: [], copies: [], removals: [], commands: [], notices: [] }),
  memoryFiles: {},
  skillRoots: async () => [],
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "agent-manager-undo-"))
  roots = { home, project: join(home, "repo"), env: {} }
  backupRoot = join(home, "state/backups")
  file = join(home, "CLAUDE.md")
  writeFileSync(file, "after")
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

function recordUndoLine() {
  mkdirSync(join(home, "state"), { recursive: true })
  const record = {
    timestamp: "2026-11-07T09:05:03.000Z",
    edits: [{ path: file, before: "before", after: "after" }],
    moves: [],
    copies: [],
    removals: [],
    hasCommands: false,
  }
  writeFileSync(join(home, "state/undo.jsonl"), `${JSON.stringify(record)}\n`)
}

// The undo reads and writes files, so the message arrives after several frames.
async function waitForText(setup: Awaited<ReturnType<typeof testRender>>, text: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await setup.waitForFrame((frame) => frame.includes(text))
    } catch (error) {
      if (attempt === 200) throw error
      await Bun.sleep(10)
    }
  }
}

test("u on the list undoes the last file change and shows the message", async () => {
  recordUndoLine()
  const setup = await testRender(<App adapters={[adapter]} roots={roots} backupRoot={backupRoot} onQuit={() => {}} />, { width: 120, height: 30 })
  try {
    await waitForText(setup, "u undo")
    setup.mockInput.pressKey("u")
    await waitForText(setup, "Undone.")
    expect(readFileSync(file, "utf8")).toBe("before")
  } finally {
    setup.renderer.destroy()
  }
})
