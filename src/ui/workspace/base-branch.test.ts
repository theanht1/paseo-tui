import { expect, it } from "vitest";
import { defaultBaseBranch } from "./base-branch.js";

it("prefers the daemon-reported base branch, then main, then master", () => {
  expect(defaultBaseBranch(["dev", "main", "trunk"], "trunk")).toBe("trunk");
  expect(defaultBaseBranch(["dev", "main"], "origin/main")).toBe("main");
  expect(defaultBaseBranch(["dev", "main", "master"], null)).toBe("main");
  expect(defaultBaseBranch(["dev", "master"], null)).toBe("master");
  expect(defaultBaseBranch(["dev", "feature"], null)).toBe("dev");
  expect(defaultBaseBranch([], null)).toBeNull();
});
