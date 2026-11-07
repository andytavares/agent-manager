import type { HarnessAdapter } from "../core/model"
import { claudeCode } from "./claude-code"
import { codex } from "./codex"
import { omp } from "./omp"
import { opencode } from "./opencode"

// Registry order decides which copy of a shared item names its harness.
export const ADAPTERS: HarnessAdapter[] = [claudeCode, codex, opencode, omp]
