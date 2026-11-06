import { expect, it } from "vitest";
import { pathCommands } from "./path-commands.js";

function run(context: Parameters<typeof pathCommands>[0]) {
  const copied: string[] = [];
  const items = pathCommands({ ...context, copy: (text) => copied.push(text) });
  for (const item of items) item.run();
  return { titles: items.map((item) => [item.title, item.subtitle]), copied };
}

it("copies the workspace path and the open file's paths", () => {
  expect(
    run({
      workspace: "/repo/trees/feat",
      file: "/repo/trees/feat/src/app.ts",
      copy: () => {},
    }),
  ).toEqual({
    titles: [
      ["Copy workspace path", "/repo/trees/feat"],
      ["Copy file path (relative)", "src/app.ts"],
      ["Copy file path (absolute)", "/repo/trees/feat/src/app.ts"],
    ],
    copied: ["/repo/trees/feat", "src/app.ts", "/repo/trees/feat/src/app.ts"],
  });
});

it("offers only what is known: no file outside an editor tab, no relative path outside the workspace", () => {
  expect(
    run({ workspace: "/repo", file: null, copy: () => {} }).titles,
  ).toEqual([["Copy workspace path", "/repo"]]);
  expect(
    run({ workspace: "/repo", file: "/etc/hosts", copy: () => {} }).titles,
  ).toEqual([
    ["Copy workspace path", "/repo"],
    ["Copy file path (absolute)", "/etc/hosts"],
  ]);
  expect(run({ workspace: null, file: null, copy: () => {} }).titles).toEqual(
    [],
  );
});
