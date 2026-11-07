import { expect, test } from "bun:test"
import { setJsonc } from "../../src/core/json-edit"

test("sets a nested key and keeps comments", () => {
  const text = '{\n  // servers\n  "mcp": {}\n}\n'
  expect(setJsonc(text, ["mcp", "linear"], { type: "remote" })).toBe('{\n  // servers\n  "mcp": {\n    "linear": {\n      "type": "remote"\n    }\n  }\n}\n')
})

test("undefined removes the key", () => {
  expect(JSON.parse(setJsonc('{ "a": 1, "b": 2 }', ["a"], undefined))).toEqual({ b: 2 })
})

test("removing the last element of a one-line array keeps valid JSON (jsonc-parser 3.3.1 bug)", () => {
  expect(JSON.parse(setJsonc('{"a": ["x", "y"], "b": 1}', ["a", 1], undefined))).toEqual({ a: ["x"], b: 1 })
  expect(JSON.parse(setJsonc('{"a": ["x", "y"], "b": 1}', ["a", 0], undefined))).toEqual({ a: ["y"], b: 1 })
  expect(JSON.parse(setJsonc('{"a": ["x"]}', ["a", 0], undefined))).toEqual({ a: [] })
})
