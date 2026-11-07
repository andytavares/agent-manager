import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { testRender } from "@opentui/react/test-utils"
import { ReviewChanges } from "../../src/app/ReviewChanges"
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
