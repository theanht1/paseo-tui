import type { ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";
import { expect, it } from "vitest";
import type { Block } from "./blocks.js";
import { blockCopyText, copyDocument } from "./copy-document.js";

const shell: ToolCallTimelineItem = {
  type: "tool_call",
  callId: "c1",
  name: "Bash",
  status: "completed",
  error: null,
  detail: { type: "shell", command: "npm   test", output: "ok\npassed" },
};
const blocks: Block[] = [
  { kind: "user", key: "u", text: "run the tests" },
  { kind: "reasoning", key: "r", text: "first\nsecond" },
  { kind: "tool", key: "t", call: shell },
  { kind: "plan", key: "p", outcome: "approved", text: "1. do it" },
  { kind: "assistant", key: "a", text: "All green." },
];

it("copies what the pane shows: collapsed blocks keep their one-line summary", () => {
  expect(blocks.map((block) => blockCopyText(block, false))).toEqual([
    "run the tests",
    "∴ thinking · 2 lines",
    "✓ Bash npm test",
    "▸ Approved plan",
    "All green.",
  ]);
});

it("includes the body of blocks the user expanded", () => {
  expect(blockCopyText(blocks[1] as Block, true)).toBe(
    "∴ thinking · 2 lines\nfirst\nsecond",
  );
  expect(blockCopyText(blocks[2] as Block, true)).toBe(
    "✓ Bash npm test\n$ npm   test\nok\npassed",
  );
  expect(blockCopyText(blocks[3] as Block, true)).toBe(
    "▾ Approved plan\n1. do it",
  );
});

it("lays blocks out with a blank line between them and records where each starts", () => {
  const doc = copyDocument(blocks.slice(0, 2), new Set(), 80);
  expect(doc.lines.map((line) => line.text)).toEqual([
    "run the tests",
    "",
    "∴ thinking · 2 lines",
  ]);
  expect([...doc.starts]).toEqual([
    ["u", 0],
    ["r", 2],
  ]);
});

it("colors lines the way the timeline draws them", () => {
  const doc = copyDocument(
    [
      { kind: "user", key: "u", text: "hi" },
      { kind: "tool", key: "t", call: shell },
      { kind: "reasoning", key: "r", text: "hmm" },
      { kind: "error", key: "e", message: "boom" },
    ],
    new Set(),
    80,
  );
  expect(
    doc.lines.map((line) => [line.text, line.style?.tone, line.style?.bold]),
  ).toEqual([
    ["hi", "user", true],
    ["", "fg", false],
    ["✓ Bash npm test", "success", false],
    ["", "fg", false],
    ["∴ thinking · 1 lines", "reasoning", false],
    ["", "fg", false],
    ["! boom", "error", false],
  ]);
});

it("styles markdown headings, bold, inline code, links and code blocks", () => {
  const doc = copyDocument(
    [
      {
        kind: "assistant",
        key: "a",
        text: "## Plan\nRun `npm test` **now**, see [docs](http://x).\n```ts\nconst a = 1;\n```",
      },
    ],
    new Set(),
    80,
  );
  const [heading, prose, fenceOpen, code, fenceClose] = doc.lines;
  expect(heading?.style).toEqual({
    tone: "heading2",
    bold: true,
    marks: [{ start: 0, end: 2, tone: "faint" }],
  });
  expect(prose?.style?.marks).toEqual([
    { start: 4, end: 5, tone: "faint" },
    { start: 5, end: 13, tone: "tool" },
    { start: 13, end: 14, tone: "faint" },
    { start: 15, end: 17, tone: "faint" },
    { start: 17, end: 20, tone: "fg", bold: true },
    { start: 20, end: 22, tone: "faint" },
    { start: 28, end: 44, tone: "accent" },
  ]);
  expect(fenceOpen?.style?.tone).toBe("faint");
  expect(code?.style?.tone).toBe("tool");
  expect(fenceClose?.style?.tone).toBe("faint");
});

it("carries marks onto each soft-wrapped row", () => {
  const doc = copyDocument(
    [{ kind: "assistant", key: "a", text: "ab `cdef` gh" }],
    new Set(),
    5,
  );
  expect(doc.lines.map((line) => [line.text, line.style?.marks])).toEqual([
    [
      "ab `c",
      [
        { start: 3, end: 4, tone: "faint" },
        { start: 4, end: 5, tone: "tool" },
      ],
    ],
    [
      "def` ",
      [
        { start: 0, end: 3, tone: "tool" },
        { start: 3, end: 4, tone: "faint" },
      ],
    ],
    ["gh", []],
  ]);
});
