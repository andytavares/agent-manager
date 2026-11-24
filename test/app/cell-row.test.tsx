import { expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { Cells, columnWidths, type Cell, type Column } from "../../src/app/CellRow"

const columns: Column[] = [
  { header: "SKILL", give: "name" },
  { header: "FOLDER", give: "path" },
  { header: "here", give: "fixed" },
]
const cells: Cell[] = [["reverse-engineer-anything"], ["~/.claude/skills/team-shared-reverse-tools/nested"], ["12"]]

test("a Cells row wider than its box wraps the path cell and keeps the name and count whole", async () => {
  const widths = columnWidths(columns, [cells])
  const setup = await testRender(
    <box width={60}>
      <Cells cells={cells} columns={columns} widths={widths} />
    </box>,
    { width: 80, height: 6 },
  )
  try {
    const frame = await setup.waitForFrame((f) => f.includes("reverse-engineer-anything"))
    const lines = frame.split("\n").filter((line) => line.trim() !== "")
    expect(lines.length).toBeGreaterThan(1)
    expect(lines[0]).toContain("reverse-engineer-anything")
    expect(lines[0]).toContain("12")
    const folderStart = lines[0]!.indexOf("~/")
    const folderEnd = lines[0]!.indexOf("12")
    const folder = lines.map((line) => line.slice(folderStart, folderEnd).trim()).join("")
    expect(folder).toBe("~/.claude/skills/team-shared-reverse-tools/nested")
    expect(frame).not.toContain("…")
  } finally {
    setup.renderer.destroy()
  }
})

test("columnWidths is the longest of the header and the cells plus a 2-cell gap", () => {
  expect(columnWidths(columns, [cells, [["pdf"], ["~/x"], ["3"]]])).toEqual([27, 51, 6])
})

test("a note column never shrinks out of sight, so a warning stays readable", async () => {
  const noteColumns: Column[] = [...columns, { header: "NOTE", give: "note" }]
  const row: Cell[] = [...cells, ["▲ secret"]]
  const setup = await testRender(
    <box width={40}>
      <Cells cells={row} columns={noteColumns} widths={columnWidths(noteColumns, [row])} />
    </box>,
    { width: 60, height: 12 },
  )
  try {
    const frame = await setup.waitForFrame((f) => f.includes("reverse-engineer-anything"))
    expect(frame).toContain("▲ secret")
  } finally {
    setup.renderer.destroy()
  }
})
