import { expect, test } from "vitest";
import {
  labelFilterPath,
  loadLabelFilterMemory,
} from "./label-filter-memory.js";

function storage(initial: string | null = null) {
  let contents = initial;
  return {
    get contents() {
      return contents;
    },
    async read() {
      return contents;
    },
    async write(next: string) {
      contents = next;
    },
  };
}

test("the filter lives beside the layouts under XDG_STATE_HOME", () => {
  expect(labelFilterPath({ XDG_STATE_HOME: "/s" }, "/home/me")).toBe(
    "/s/paseo-tui/label-filter.json",
  );
  expect(labelFilterPath({}, "/home/me")).toBe(
    "/home/me/.local/state/paseo-tui/label-filter.json",
  );
});

test("keeps the selected label keys across a restart", async () => {
  const file = storage();
  const memory = await loadLabelFilterMemory(file);
  expect(memory.getSnapshot()).toEqual([]);
  let changes = 0;
  memory.subscribe(() => changes++);
  memory.set(["bug", ""]);
  memory.set(["bug", ""]);
  expect(changes).toBe(1);
  await memory.flush();
  const restarted = await loadLabelFilterMemory(storage(file.contents));
  expect(restarted.getSnapshot()).toEqual(["bug", ""]);
});

test("ignores a damaged file", async () => {
  expect((await loadLabelFilterMemory(storage("{"))).getSnapshot()).toEqual([]);
  expect(
    (
      await loadLabelFilterMemory(
        storage('{"version":1,"labels":["bug",3,null]}'),
      )
    ).getSnapshot(),
  ).toEqual(["bug"]);
});
