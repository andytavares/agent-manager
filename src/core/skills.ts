import { existsSync } from "node:fs"
import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { parse } from "yaml"

export interface SkillFolder {
  name: string // folder name; the skill's id in every harness
  path: string
}

// Skills live one level deep: <root>/<name>/SKILL.md. Symlinked folders count.
export async function listSkillFolders(root: string): Promise<SkillFolder[]> {
  if (!existsSync(root)) return []
  const entries = await readdir(root)
  return entries
    .filter((name) => existsSync(join(root, name, "SKILL.md")))
    .sort()
    .map((name) => ({ name, path: join(root, name) }))
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export function parseFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const match = FRONTMATTER.exec(text)
  if (!match) return { data: {}, body: text }
  return { data: (parse(match[1]!) ?? {}) as Record<string, unknown>, body: text.slice(match[0].length) }
}
