import { expect, test } from "bun:test"
import { search } from "../../src/memory/fuzzy"
import type { AutoEntry } from "../../src/memory/types"

function entry(fields: Partial<AutoEntry> & { title: string }): AutoEntry {
  return {
    level: "project",
    kind: "auto-entry",
    path: "/memory/x.md",
    readOnly: false,
    loadsAtStart: false,
    lines: 1,
    bytes: 1,
    mtimeMs: 0,
    file: "x.md",
    name: "x",
    hook: "",
    description: "",
    type: null,
    body: "",
    frontmatterRaw: "",
    frontmatterValid: true,
    indexLine: null,
    pastLoadLimit: false,
    links: [],
    modified: null,
    ...fields,
  }
}

const titles = (entries: AutoEntry[]) => entries.map((e) => e.title)

test("an empty query returns the pool unchanged", () => {
  const pool = [entry({ title: "Vault", file: "vault.md" }), entry({ title: "Bot", file: "bot.md" })]
  expect(search("   ", pool)).toEqual(pool)
})

test("ranks a title match above a description-only match", () => {
  const runbook = entry({ title: "Vault secrets runbook", file: "reference_vault.md" })
  const handbook = entry({ title: "Handbooks", file: "handbooks.md", body: "the runbook lives here" })
  expect(titles(search("runbook", [handbook, runbook]))).toEqual(["Vault secrets runbook", "Handbooks"])
})

test("requires every token to match, so a query with two words drops one-word entries", () => {
  const both = entry({ title: "Vault beta notes", file: "vault_beta_notes.md" })
  const vaultOnly = entry({ title: "Vault secrets", file: "vault_secrets.md" })
  const betaOnly = entry({ title: "Beta only", file: "beta_only.md" })
  expect(titles(search("vault beta", [vaultOnly, both, betaOnly]))).toEqual(["Vault beta notes"])
})

test("a two-character token does not match letters scattered in the body", () => {
  const notes = entry({ title: "Notes", file: "notes.md", body: "pizza zzz here" })
  expect(search("zz", [notes])).toEqual([])
})

test("a three-character token matches inside the body", () => {
  const notes = entry({ title: "Notes", file: "notes.md", body: "the runbook lives here" })
  expect(titles(search("runbook", [notes]))).toEqual(["Notes"])
})

test("returns nothing when no field matches", () => {
  expect(search("zzz", [entry({ title: "Alpha", file: "alpha.md" })])).toEqual([])
})
