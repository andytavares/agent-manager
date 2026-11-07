import { expect, test } from "bun:test"
import { join } from "node:path"
import { listSkillFolders, parseFrontmatter } from "../../src/core/skills"

const root = join(import.meta.dir, "../fixtures/skills/root")

test("lists only folders that hold a SKILL.md, sorted by name", async () => {
  const skills = await listSkillFolders(root)
  expect(skills.map((s) => s.name)).toEqual(["pdf", "research"])
  expect(skills[1]!.path).toBe(join(root, "research"))
})

test("a missing root gives no skills", async () => {
  expect(await listSkillFolders(join(root, "absent"))).toEqual([])
})

test("parses YAML frontmatter and keeps the body", () => {
  const parsed = parseFrontmatter("---\nname: research\ndescription: x\n---\n\nBody\n")
  expect(parsed.data).toEqual({ name: "research", description: "x" })
  expect(parsed.body).toBe("\nBody\n")
})

test("text without frontmatter is all body", () => {
  expect(parseFrontmatter("Just text\n")).toEqual({ data: {}, body: "Just text\n" })
})
