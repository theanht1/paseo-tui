import { TextAttributes } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { afterEach, expect, it } from "vitest";
import { TerminalSurfaceRenderable } from "./terminal-surface.js";

let destroy: () => void = () => {};
afterEach(() => destroy());

async function mountSurface(output: string) {
  const test = await createTestRenderer({ width: 20, height: 6 });
  destroy = () => test.renderer.destroy();
  const surface = new TerminalSurfaceRenderable(test.renderer, {
    left: 2,
    top: 1,
    width: 10,
    height: 3,
    position: "absolute",
  });
  test.renderer.root.add(surface);
  surface.write(output);
  await test.renderOnce();
  return { test, surface };
}

function inverseFrame(
  test: Awaited<ReturnType<typeof createTestRenderer>>,
): string[] {
  return test.captureSpans().lines.flatMap((line, row) => {
    let col = 0;
    return line.spans.flatMap((span) => {
      const start = col;
      col += span.width;
      return span.attributes & TextAttributes.INVERSE
        ? [`${start},${row}:${span.text}`]
        : [];
    });
  });
}

it("paints an inverted cursor cell when the terminal is not focused", async () => {
  const { test } = await mountSurface("abc\x1b[1;2H");
  expect(inverseFrame(test)).toEqual(["3,1:b"]);
  await test.renderOnce();
  await test.renderOnce();
  expect(inverseFrame(test)).toEqual(["3,1:b"]);
});

it("follows the cursor and paints empty cells", async () => {
  const { test, surface } = await mountSurface("abc\x1b[1;2H");
  surface.write("\x1b[2;5H");
  await test.renderOnce();
  expect(inverseFrame(test)).toEqual(["6,2: "]);
});

it("does not paint a cursor the app hid", async () => {
  const { test } = await mountSurface("abc\x1b[1;2H\x1b[?25l");
  expect(inverseFrame(test)).toEqual([]);
});

it("leaves the hardware cursor to OpenTUI when focused", async () => {
  const { test, surface } = await mountSurface("abc\x1b[1;2H");
  surface.focus();
  await test.renderOnce();
  expect(inverseFrame(test)).toEqual([]);
  expect(test.captureSpans().cursor).toEqual([4, 2]);
});
