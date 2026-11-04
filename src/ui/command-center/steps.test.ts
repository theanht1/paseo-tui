import { expect, test } from "vitest";
import type { CommandStep } from "./registry.js";
import { back, push } from "./steps.js";

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
  first[0].query = "Edited";
  first[0].selected = 2;
  expect(
    back(push(first, { kind: "confirm", title: "Sure?", confirm() {} })),
  ).toEqual(first);
  expect(back(first)).toBeNull();
  expect(back([])).toBeNull();
});
