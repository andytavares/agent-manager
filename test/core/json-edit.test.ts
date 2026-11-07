import { expect, test } from "bun:test"
import { setJsonc } from "../../src/core/json-edit"

test("sets a nested key and keeps comments", () => {
  const text = '{\n  // servers\n  "mcp": {}\n}\n'
  expect(setJsonc(text, ["mcp", "linear"], { type: "remote" })).toBe('{\n  // servers\n  "mcp": {\n    "linear": {\n      "type": "remote"\n    }\n  }\n}\n')
})

test("undefined removes the key", () => {
  expect(JSON.parse(setJsonc('{ "a": 1, "b": 2 }', ["a"], undefined))).toEqual({ b: 2 })
})
