import { expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { Dialog } from "../../src/app/Dialog"

test("Dialog draws a titled frame of the given width in the middle of the screen", async () => {
  const setup = await testRender(
    <Dialog title="Add memory" right="Step 1 of 5" width={60}>
      <text>Which harness should load it?</text>
    </Dialog>,
    { width: 120, height: 20 },
  )
  try {
    const frame = await setup.waitForFrame((f) => f.includes("Which harness"))
    const top = frame.split("\n").find((line) => line.includes("Add memory"))!
    expect(top.indexOf("╭")).toBe(30)
    expect(frame).toContain("Step 1 of 5")
  } finally {
    setup.renderer.destroy()
  }
})
