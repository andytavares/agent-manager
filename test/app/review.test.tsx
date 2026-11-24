import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/react/test-utils"
import { ReviewChanges } from "../../src/app/ReviewChanges"
import { theme } from "../../src/app/theme"
import type { WritePlan } from "../../src/core/model"

const empty: WritePlan = { edits: [], moves: [], copies: [], removals: [], commands: [], notices: [] }

async function render(plan: WritePlan, secrets: string[], onApplied: (message: string) => void = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), "review-"))
  const setup = await testRender(
    <ReviewChanges plan={plan} secrets={secrets} backupRoot={join(dir, "backups")} home={dir} onApplied={onApplied} onBack={() => {}} />,
    { width: 120, height: 30 },
  )
  return { setup, dir }
}

test("pressing enter twice applies the plan once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "review-file-"))
  const log = join(dir, "runs.txt")
  const messages: string[] = []
  const plan = { ...empty, commands: [{ argv: ["sh", "-c", `sleep 0.1; echo run >> "${log}"`], touches: [] }] }
  const { setup } = await render(plan, [], (m) => messages.push(m))
  try {
    setup.mockInput.pressEnter()
    setup.mockInput.pressEnter()
    for (let tries = 0; tries < 40 && messages.length === 0; tries++) await Bun.sleep(25)
    await Bun.sleep(300)
    expect(readFileSync(log, "utf8")).toBe("run\n")
  } finally {
    setup.renderer.destroy()
  }
})

test("only quoted secret values of 4+ characters are masked; short values stay readable", async () => {
  const plan = { ...empty, commands: [{ argv: ["claude", "mcp", "add-json", "x", '{"env":{"DEBUG":"1","TOKEN":"sk-live-123"}}'], touches: [] }] }
  const { setup } = await render(plan, ["1", "sk-live-123"])
  try {
    const frame = await setup.waitForFrame((f) => f.includes("run command"))
    expect(frame).toContain('"DEBUG":"1"')
    expect(frame).toContain('"TOKEN":"••••••••"')
    expect(frame).not.toContain("sk-live-123")
  } finally {
    setup.renderer.destroy()
  }
})

test("plan notices show before apply", async () => {
  const { setup } = await render({ ...empty, notices: ["Codex ignores this file until you trust the project."] }, [])
  try {
    expect(await setup.waitForFrame((f) => f.includes("trust the project"))).toContain("Codex ignores this file")
  } finally {
    setup.renderer.destroy()
  }
})

test("the summary counts one edited file and one changed line in the singular", async () => {
  const edit = { path: "/repo/notes.md", before: "keep\nold line\n", after: "keep\nnew line\n" }
  const { setup } = await render({ ...empty, edits: [edit] }, [])
  try {
    const frame = await setup.waitForFrame((f) => f.includes("notes.md"))
    expect(frame).toContain("Review changes")
    expect(frame).toContain("1 file edited · 1 line changed")
    expect(frame).not.toContain("1 changes")
  } finally {
    setup.renderer.destroy()
  }
})

test("the summary counts lines removed and commands", async () => {
  const edit = { path: "/repo/MEMORY.md", before: "one\ntwo\nthree\n", after: "one\n" }
  const command = { argv: ["claude", "mcp", "remove", "files"], touches: [] }
  const { setup } = await render({ ...empty, edits: [edit], commands: [command] }, [])
  try {
    const frame = await setup.waitForFrame((f) => f.includes("MEMORY.md"))
    expect(frame).toContain("1 file edited · 2 lines removed · 1 command")
  } finally {
    setup.renderer.destroy()
  }
})

test("the diff of a 40-line file shows the changed line with 3 lines of context, not the whole file", async () => {
  const lines = Array.from({ length: 40 }, (_, index) => `alpha-${String(index + 1).padStart(2, "0")}`)
  const after = lines.map((line) => (line === "alpha-20" ? "beta-20" : line))
  const edit = { path: "/repo/long.md", before: `${lines.join("\n")}\n`, after: `${after.join("\n")}\n` }
  const { setup } = await render({ ...empty, edits: [edit] }, [])
  try {
    const frame = await setup.waitForFrame((f) => f.includes("beta-20"))
    expect(frame).toContain("alpha-17")
    expect(frame).toContain("alpha-23")
    expect(frame).not.toContain("alpha-01")
    expect(frame).not.toContain("alpha-16")
    expect(frame).not.toContain("alpha-24")
  } finally {
    setup.renderer.destroy()
  }
})

test("down arrow scrolls a plan longer than the screen to its last line", async () => {
  const notices = Array.from({ length: 40 }, (_, index) => `notice number ${index + 1}`)
  const { setup } = await render({ ...empty, notices }, [])
  try {
    expect(await setup.waitForFrame((f) => f.includes("notice number 1"))).not.toContain("notice number 40")
    for (const _ of notices) setup.mockInput.pressArrow("down")
    expect(await setup.waitForFrame((f) => f.includes("notice number 40"))).toContain("notice number 40")
  } finally {
    setup.renderer.destroy()
  }
})

test("an apply failure shows its message in the theme error colour", async () => {
  const dir = mkdtempSync(join(tmpdir(), "review-stale-"))
  const path = join(dir, "notes.md")
  writeFileSync(path, "changed on disk\n")
  const { setup } = await render({ ...empty, edits: [{ path, before: "read earlier\n", after: "new\n" }] }, [])
  try {
    await setup.waitForFrame((f) => f.includes("notes.md"))
    setup.mockInput.pressEnter()
    await setup.waitForFrame((f) => f.includes("changed since it was read"))
    const spans = setup.captureSpans().lines.flatMap((line) => line.spans)
    const failure = spans.find((span) => span.text.includes("changed since it was read"))
    expect(failure?.fg.equals(RGBA.fromHex(theme.err))).toBe(true)
  } finally {
    setup.renderer.destroy()
  }
})
