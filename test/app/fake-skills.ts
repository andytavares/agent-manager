import { mock } from "bun:test"
import type { Change, HarnessId, WritePlan } from "../../src/core/model"

// planSkill and skillChecks are swapped per test. Without a swap they call the real module,
// so other test files in the same process see the real behaviour.
const real = { ...(await import("../../src/core/skills")) } as Record<string, unknown>
type PlanSkill = (change: Change, readers: HarnessId[]) => Promise<WritePlan>
type SkillChecks = (harness: HarnessId, folderName: string, text: string) => string[]
export const fakeSkills: { planSkill?: PlanSkill; skillChecks?: SkillChecks } = {}

mock.module("../../src/core/skills", () => ({
  ...real,
  planSkill: (change: Change, readers: HarnessId[]) => (fakeSkills.planSkill ?? (real.planSkill as PlanSkill))(change, readers),
  skillChecks: (harness: HarnessId, folderName: string, text: string) =>
    (fakeSkills.skillChecks ?? (real.skillChecks as SkillChecks))(harness, folderName, text),
}))

export const EMPTY_PLAN: WritePlan = { edits: [], moves: [], copies: [], removals: [], commands: [], notices: [] }
