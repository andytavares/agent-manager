import { expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { EMPTY_PLAN } from "./fake-skills"
import type { HarnessAdapter, Item } from "../../src/core/model"
import { type FlowContext, marketplaceList } from "../../src/app/flows"
import { Marketplaces } from "../../src/app/Marketplaces"

const roots = { home: "/home/dev", project: "/home/dev/repo", env: {} }

function plugin(name: string): Item {
  return { kind: "plugin", harness: "claude-code", scope: "global", name, path: "/home/dev/.claude/settings.json", key: `enabledPlugins.${name}`, loadedBy: ["claude-code"] }
}

function contextWith(adapter: HarnessAdapter): FlowContext {
  return { adapters: [adapter], roots, scope: "global", review: () => {}, open: () => {}, back: () => {}, notify: () => {} }
}

test("marketplaceList counts the installed plugins of each marketplace by their @marketplace suffix", async () => {
  const adapter: HarnessAdapter = {
    id: "claude-code",
    label: "Claude Code",
    scopes: ["global"],
    detect: async () => true,
    list: async (kind) => (kind === "plugin" ? [plugin("alpha@mkt"), plugin("beta@mkt"), plugin("github@official"), plugin("beta@mkt-old")] : []),
    read: async () => ({ type: "text", text: "" }),
    plan: async () => EMPTY_PLAN,
    memoryFiles: {},
    skillRoots: async () => [],
    marketplaces: async () => [
      { name: "mkt", source: "github · acme/claude-plugins" },
      { name: "empty", source: "github · acme/empty" },
    ],
  }
  const screen = await marketplaceList(contextWith(adapter))
  expect(screen).toMatchObject({ name: "marketplaces", marketplaces: [{ name: "mkt", installed: 2 }, { name: "empty", installed: 0 }] })
})

test("Marketplaces shows one row per marketplace with its harness, source and installed count", async () => {
  const marketplaces = [{ harness: "claude-code" as const, name: "mkt", source: "github · acme/claude-plugins", installed: 3 }]
  const setup = await testRender(<Marketplaces marketplaces={marketplaces} onAdd={() => {}} onRemove={() => {}} onBack={() => {}} />, { width: 120, height: 20 })
  try {
    const frame = await setup.waitForFrame((f) => f.includes("mkt"))
    expect(frame).toMatch(/NAME +HARNESS +SOURCE +INSTALLED/)
    expect(frame).toMatch(/▌ mkt +Claude Code +github · acme\/claude-plugins +3 plugins/)
  } finally {
    setup.renderer.destroy()
  }
})

test("Marketplaces without any marketplace says how to add one", async () => {
  const setup = await testRender(<Marketplaces marketplaces={[]} onAdd={() => {}} onRemove={() => {}} onBack={() => {}} />, { width: 120, height: 20 })
  try {
    const frame = await setup.waitForFrame((f) => f.includes("Marketplaces"))
    expect(frame).toContain("No marketplaces. Press a to add one.")
  } finally {
    setup.renderer.destroy()
  }
})

test("Marketplaces shows a source longer than 40 characters in full", async () => {
  const source = "github · acme-corporation/claude-code-plugins-for-the-platform-team"
  const marketplaces = [{ harness: "claude-code" as const, name: "platform", source, installed: 3 }]
  const setup = await testRender(<Marketplaces marketplaces={marketplaces} onAdd={() => {}} onRemove={() => {}} onBack={() => {}} />, { width: 120, height: 20 })
  try {
    const frame = await setup.waitForFrame((f) => f.includes("platform"))
    expect(frame).toContain(source)
    expect(frame).toContain("3 plugins")
  } finally {
    setup.renderer.destroy()
  }
})
