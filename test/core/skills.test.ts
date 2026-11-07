import { beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Change, Item } from "../../src/core/model"
import { listSkillFolders, parseFrontmatter, planSkill, skillChecks } from "../../src/core/skills"

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

const skill = (frontmatter: string) => `---\n${frontmatter}\n---\nBody\n`

describe("skillChecks", () => {
  test("Codex requires name and description", () => {
    expect(skillChecks("codex", "pdf", skill("name: pdf\ndescription: Read PDFs"))).toEqual([])
    expect(skillChecks("codex", "pdf", skill("description: Read PDFs"))).toEqual(["Codex: name is required"])
    expect(skillChecks("codex", "pdf", skill("name: pdf\ndescription:"))).toEqual(["Codex: description is required"])
    expect(skillChecks("codex", "pdf", "No frontmatter\n")).toEqual([
      "Codex: name is required",
      "Codex: description is required",
    ])
  })

  test("OpenCode requires a description of 1-1024 characters", () => {
    expect(skillChecks("opencode", "pdf", skill("description: Read PDFs"))).toEqual([])
    expect(skillChecks("opencode", "pdf", skill("name: pdf"))).toEqual(["OpenCode: description is required"])
    expect(skillChecks("opencode", "pdf", skill('description: ""'))).toEqual(["OpenCode: description is required"])
    expect(skillChecks("opencode", "pdf", skill(`description: ${"x".repeat(1024)}`))).toEqual([])
    expect(skillChecks("opencode", "pdf", skill(`description: ${"x".repeat(1025)}`))).toEqual([
      "OpenCode: description must be at most 1024 characters",
    ])
  })

  test("OpenCode checks a present name: lowercase-hyphen form, 1-64 characters, equal to the folder name", () => {
    expect(skillChecks("opencode", "pdf-tools", skill("name: pdf-tools\ndescription: x"))).toEqual([])
    expect(skillChecks("opencode", "Pdf_Tools", skill("name: Pdf_Tools\ndescription: x"))).toEqual([
      "OpenCode: name must use lowercase letters, digits and single hyphens",
    ])
    expect(skillChecks("opencode", "pdf", skill("name: pdf-\ndescription: x"))).toEqual([
      "OpenCode: name must use lowercase letters, digits and single hyphens",
      "OpenCode: name must match the folder name",
    ])
    const long = "a".repeat(65)
    expect(skillChecks("opencode", long, skill(`name: ${long}\ndescription: x`))).toEqual([
      "OpenCode: name must be at most 64 characters",
    ])
    expect(skillChecks("opencode", "pdf", skill("name: research\ndescription: x"))).toEqual([
      "OpenCode: name must match the folder name",
    ])
  })

  test("Claude Code and omp accept missing fields but flag frontmatter that does not parse", () => {
    expect(skillChecks("claude-code", "pdf", "No frontmatter\n")).toEqual([])
    expect(skillChecks("omp", "pdf", skill("name: x"))).toEqual([])
    const broken = skill("name: [unclosed")
    expect(skillChecks("claude-code", "pdf", broken)).toHaveLength(1)
    expect(skillChecks("claude-code", "pdf", broken)[0]).toStartWith("Claude Code: frontmatter does not parse:")
    expect(skillChecks("omp", "pdf", broken)[0]).toStartWith("omp: frontmatter does not parse:")
    expect(skillChecks("codex", "pdf", broken)).toHaveLength(1)
    expect(skillChecks("codex", "pdf", broken)[0]).toStartWith("Codex: frontmatter does not parse:")
  })
})

describe("planSkill", () => {
  let skills: string
  let other: string
  const target = { harness: "claude-code" as const, scope: "global" as const }
  const empty = { edits: [], moves: [], copies: [], removals: [], commands: [], notices: [] }

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "skills-"))
    skills = join(dir, "skills")
    other = join(dir, "other")
    await mkdir(join(skills, "pdf"), { recursive: true })
    await writeFile(join(skills, "pdf/SKILL.md"), skill("name: pdf\ndescription: Read PDFs"))
    await mkdir(other)
  })

  const item = (extra: Partial<Item> = {}): Item => ({
    kind: "skill",
    harness: "claude-code",
    scope: "global",
    name: "pdf",
    path: join(skills, "pdf"),
    loadedBy: ["claude-code"],
    ...extra,
  })
  const change = (extra: Partial<Change>): Change => ({ kind: "skill", op: "create", target, ...extra })

  test("create writes <root>/<name>/SKILL.md with the given text", async () => {
    const text = skill("name: research\ndescription: Search")
    const plan = await planSkill(change({ destination: skills, name: "research", text }), ["codex", "opencode"])
    expect(plan).toEqual({ ...empty, edits: [{ path: join(skills, "research/SKILL.md"), before: null, after: text }] })
  })

  test("create without text writes the template", async () => {
    const plan = await planSkill(change({ destination: skills, name: "research" }), ["claude-code"])
    expect(plan.edits).toEqual([
      { path: join(skills, "research/SKILL.md"), before: null, after: "---\nname: research\ndescription:\n---\n\n" },
    ])
  })

  test("create with no readers skips the checks", async () => {
    const plan = await planSkill(change({ destination: skills, name: "research" }), [])
    expect(plan.edits).toHaveLength(1)
  })

  test("create passes when one reader accepts the text", async () => {
    const plan = await planSkill(change({ destination: skills, name: "research" }), ["codex", "claude-code"])
    expect(plan.edits).toHaveLength(1)
  })

  test("create refuses when every reader rejects the text, naming the problems", async () => {
    await expect(planSkill(change({ destination: skills, name: "research" }), ["codex", "opencode"])).rejects.toThrow(
      "Codex: description is required",
    )
  })

  test("create refuses an existing folder", async () => {
    await expect(planSkill(change({ destination: skills, name: "pdf" }), [])).rejects.toThrow("already exists")
  })

  test("create refuses a name that is not one path segment", async () => {
    for (const name of ["", ".", "..", "a/b", "../x", "a\\b"]) {
      await expect(planSkill(change({ destination: skills, name }), [])).rejects.toThrow("folder name")
    }
  })

  test("update edits SKILL.md from the current text to the new text", async () => {
    const after = skill("name: pdf\ndescription: New")
    const plan = await planSkill(change({ op: "update", item: item(), text: after }), ["claude-code"])
    expect(plan).toEqual({
      ...empty,
      edits: [{ path: join(skills, "pdf/SKILL.md"), before: skill("name: pdf\ndescription: Read PDFs"), after }],
    })
  })

  test("update uses the text the editor opened with when given", async () => {
    const plan = await planSkill(change({ op: "update", item: item(), text: "new", before: "opened" }), ["claude-code"])
    expect(plan.edits).toEqual([{ path: join(skills, "pdf/SKILL.md"), before: "opened", after: "new" }])
  })

  test("delete removes the folder", async () => {
    expect(await planSkill(change({ op: "delete", item: item() }), [])).toEqual({
      ...empty,
      removals: [join(skills, "pdf")],
    })
  })

  test("move and copy target <destination>/<folder name>", async () => {
    const pair = { from: join(skills, "pdf"), to: join(other, "pdf") }
    expect(await planSkill(change({ op: "move", item: item(), destination: other }), [])).toEqual({ ...empty, moves: [pair] })
    expect(await planSkill(change({ op: "copy", item: item(), destination: other }), [])).toEqual({ ...empty, copies: [pair] })
  })

  test("move and copy refuse when the destination already holds the folder name", async () => {
    await mkdir(join(other, "pdf"))
    for (const op of ["move", "copy"] as const) {
      await expect(planSkill(change({ op, item: item(), destination: other }), [])).rejects.toThrow("already exists")
    }
  })

  test("update, delete, move and copy refuse a read-only item", async () => {
    const readOnly = item({ readOnly: "imported from Codex" })
    for (const op of ["update", "delete", "move", "copy"] as const) {
      const attempt = planSkill(change({ op, item: readOnly, destination: other, text: "x" }), [])
      await expect(attempt).rejects.toThrow("imported from Codex")
    }
  })
})
