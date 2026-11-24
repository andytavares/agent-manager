import { expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { ScrollList } from "../../src/app/ScrollList"

const rows = Array.from({ length: 30 }, (_, index) => ({ id: `row-${index}`, node: <text>{`item ${index}`}</text> }))

test("ScrollList draws rows at full height and scrolls the selected row into view", async () => {
  const setup = await testRender(<ScrollList rows={rows} selectedId="row-25" />, { width: 40, height: 10 })
  try {
    const frame = await setup.waitForFrame((f) => f.includes("item 25"))
    expect(frame).toContain("item 25")
    expect(frame).not.toContain("item 0\n")
  } finally {
    setup.renderer.destroy()
  }
})

test("ScrollList shows the first rows in order when nothing is selected", async () => {
  const setup = await testRender(<ScrollList rows={rows} />, { width: 40, height: 10 })
  try {
    const frame = await setup.waitForFrame((f) => f.includes("item 0"))
    const lines = frame.split("\n").filter((line) => line.includes("item"))
    expect(lines.slice(0, 3).map((line) => line.trim().split(/\s{2,}/)[0])).toEqual(["item 0", "item 1", "item 2"])
  } finally {
    setup.renderer.destroy()
  }
})
