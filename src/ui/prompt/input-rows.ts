import type { EditBufferRenderable } from "@opentui/core";

/** Rows an input needs to show `lines` wrapped lines, from one row up to `max`. */
export function inputRows(lines: number, max: number): number {
  return Math.min(Math.max(lines, 1), max);
}
/**
 * The rows `input` needs now. Text scrolled while its box was smaller stays scrolled
 * when the box grows, so once it all fits the view goes back to the first line.
 */
export function fitInput(input: EditBufferRenderable, max: number): number {
  const lines = input.editorView.getTotalVirtualLineCount();
  const rows = inputRows(lines, max);
  const { offsetX, offsetY, width } = input.editorView.getViewport();
  if (offsetY > 0 && lines <= rows)
    input.editorView.setViewport(offsetX, 0, width, rows, false);
  return rows;
}
