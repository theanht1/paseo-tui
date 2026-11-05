import { expect, it } from "vitest";
import { createKeyRouter } from "./key-router.js";

const stroke = (name: string, ctrl = false) => ({
  name,
  ctrl,
  meta: false,
  shift: false,
  sequence: name,
});

it("offers keys to the most recent active owner first", () => {
  const router = createKeyRouter();
  const seen: string[] = [];
  router.claim((key) => {
    seen.push(`prompt:${key.name}`);
    return key.name === "c";
  });
  const release = router.claim((key) => {
    seen.push(`popup:${key.name}`);
    return key.name === "n";
  });
  expect(router.route(stroke("n", true))).toBe(true);
  expect(router.route(stroke("c", true))).toBe(true);
  expect(router.route(stroke("x"))).toBe(false);
  expect(seen).toEqual([
    "popup:n",
    "popup:c",
    "prompt:c",
    "popup:x",
    "prompt:x",
  ]);
  release();
  seen.length = 0;
  router.route(stroke("n", true));
  expect(seen).toEqual(["prompt:n"]);
});
