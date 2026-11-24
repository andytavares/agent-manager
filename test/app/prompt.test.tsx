import { expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { Prompt } from "../../src/app/Prompt"

test("a step with no options says so, and enter does nothing", async () => {
  const done: string[][] = []
  const setup = await testRender(
    <Prompt title="Move skill lint" nextStep={() => ({ label: "Move it to which folder?", options: [] })} onDone={(answers) => done.push(answers)} onCancel={() => {}} />,
    { width: 100, height: 20 },
  )
  try {
    await setup.waitForFrame((f) => f.includes("Move it to which folder?"))
    setup.mockInput.pressEnter()
    await setup.renderOnce()
    const frame = await setup.waitForFrame((f) => f.includes("No choices"))
    expect(frame).toContain("esc")
    expect(done).toEqual([])
  } finally {
    setup.renderer.destroy()
  }
})

test("a long option description wraps under itself and shows in full", async () => {
  const description = "Copies the skill into every harness folder that reads skills, then removes the original copy from this project"
  const options = [{ name: "Copy everywhere", description, value: "everywhere" }]
  const setup = await testRender(
    <Prompt title="Move skill lint" nextStep={() => ({ label: "Move it where?", options })} onDone={() => {}} onCancel={() => {}} />,
    { width: 100, height: 20 },
  )
  try {
    const frame = await setup.waitForFrame((f) => f.includes("Copy everywhere"))
    const rowLines = frame.split("\n").filter((line) => line.includes("▌"))
    const column = rowLines[0]!.indexOf("Copies")
    const shown = rowLines.map((line) => line.slice(column).replace(/│.*$/, "").trim()).join(" ")
    expect(shown).toBe(description)
  } finally {
    setup.renderer.destroy()
  }
})
