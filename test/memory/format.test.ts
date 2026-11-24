import { expect, test } from "bun:test"
import { shortPath } from "../../src/memory/format"

test("shortPath keeps a path that fits", () => {
  expect(shortPath("~/.codex/config.toml", 30)).toBe("~/.codex/config.toml")
})

test("shortPath cuts from the middle and keeps the file name", () => {
  const path = "~/.claude/projects/-Users-dev-repos-shop/memory/release-process.md"
  const short = shortPath(path, 40)
  expect(short).toBe("~/.claude/…/memory/release-process.md")
  expect(short.length).toBeLessThanOrEqual(40)
})

test("shortPath falls back to an end cut when the file name alone is too long", () => {
  expect(shortPath("~/a/very-long-file-name-that-does-not-fit.md", 12)).toBe("~/a/very-lo…")
})
