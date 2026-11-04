import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { expect, it } from "vitest";

it("routes mouse clicks only to the box at the clicked coordinates", async () => {
  const test = await createTestRenderer({ width: 60, height: 20 });
  let clicks = 0;
  const mouseHandlers = {
    onMouseDown() {
      clicks += 1;
    },
  };
  try {
    flushSync(() =>
      createRoot(test.renderer).render(
        <box width={10} height={3} {...mouseHandlers}>
          <text>Click</text>
        </box>,
      ),
    );
    await test.waitForFrame((frame) => frame.includes("Click"));
    await test.mockMouse.click(2, 1);
    expect(clicks).toBe(1);
    await test.mockMouse.click(20, 10);
    expect(clicks).toBe(1);
  } finally {
    await test.dispose();
  }
});
