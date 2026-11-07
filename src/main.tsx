#!/usr/bin/env bun
import { homedir } from "node:os"
import { resolve } from "node:path"
import { parseArgs } from "node:util"
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { ADAPTERS } from "./adapters"
import { App } from "./app/App"

const { values } = parseArgs({ options: { project: { type: "string" } } })
const roots = { home: homedir(), project: resolve(values.project ?? process.cwd()), env: process.env }

const renderer = await createCliRenderer({ exitOnCtrlC: true })
createRoot(renderer).render(<App adapters={ADAPTERS} roots={roots} onQuit={() => renderer.destroy()} />)
