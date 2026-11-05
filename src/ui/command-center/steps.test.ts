import { expect, test } from "vitest";
import { at } from "../../test/at.js";
import type { CommandStep } from "./registry.js";
import { back, breadcrumb, push } from "./steps.js";

test("push initializes inputs and back preserves the previous entry", () => {
  const step: CommandStep = {
    kind: "input",
    title: "Rename",
    placeholder: "Name",
    initial: "Alpha",
    submit(): undefined {},
  };
  const first = push([], step);
  expect(first[0]).toEqual({ step, query: "Alpha", selected: 0 });
  at(first, 0).query = "Edited";
  at(first, 0).selected = 2;
  expect(
    back(push(first, { kind: "confirm", title: "Sure?", confirm() {} })),
  ).toEqual(first);
  expect(back(first)).toBeNull();
  expect(back([])).toBeNull();
});
test("breadcrumb keeps the title and newest steps, eliding the middle to fit", () => {
  expect(breadcrumb("New tab", ["Tab type"], 40)).toBe("New tab › Tab type");
  expect(
    breadcrumb(
      "New workspace",
      ["Project", "Workspace", "Provider", "Model", "Mode", "Thinking"],
      40,
    ),
  ).toBe("New workspace › … › Mode › Thinking");
  expect(breadcrumb("Command Center", ["A very long step title"], 20)).toBe(
    "Command Center › …",
  );
});
