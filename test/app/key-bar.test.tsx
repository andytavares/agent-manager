import { expect, test } from "bun:test"
import { fitHints, type KeyHint } from "../../src/app/KeyBar"

const actions: KeyHint[] = [["a", "add"], ["e", "edit"], ["d", "delete"]]
const shell: KeyHint[] = [["/", "filter"], ["u", "undo"], ["?", "all keys"]]

test("fitHints keeps every group that fits", () => {
  expect(fitHints([actions, shell], 120)).toEqual([actions, shell])
})

test("fitHints drops action hints from the end and always keeps the last group", () => {
  const kept = fitHints([actions, shell], 40)
  expect(kept.at(-1)).toEqual(shell)
  expect(kept[0]).toEqual([["a", "add"]])
})
