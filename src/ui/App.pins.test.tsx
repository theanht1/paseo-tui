import { expect, it } from "vitest";
import { settle, setup } from "../test/app-harness.js";
import { PINS_UNSUPPORTED } from "./command-center/pin-commands.js";

async function pinnable(options: { supported?: boolean; error?: Error } = {}) {
  const calls: string[] = [];
  let pins = 0;
  let update: (id: string, at: string | null) => void = () => {};
  const harness = await setup(
    undefined,
    24,
    true,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    {
      workspacePins: {
        canPin: () => options.supported !== false,
        async setPinned(id, pinned) {
          calls.push(`${pinned ? "pin" : "unpin"} ${id}`);
          if (options.error) throw options.error;
          pins++;
          update(id, pinned ? `2026-11-06T00:00:${pins}0Z` : null);
        },
      },
    },
  );
  update = (id, at) => harness.updateWorkspace(id, { pinnedAt: at });
  const y = (id: string) =>
    harness.test.renderer.root.findDescendantById(`workspace:${id}`)?.y ?? -1;
  const line = (text: string) =>
    harness.app
      .lastFrame()
      .split("\n")
      .findIndex((row) => row.includes(text));
  return { ...harness, calls, y, line };
}
async function press(
  app: { stdin: { write(input: string): void } },
  keys: string[],
) {
  for (const key of keys) {
    app.stdin.write(key);
    await settle();
  }
}

it("p pins the workspace under the cursor into Pinned at the top, and p again puts it back", async () => {
  const { app, calls, y, line } = await pinnable();
  expect(y("one")).toBeLessThan(y("two"));
  expect(line("Pinned")).toBe(-1);
  await press(app, ["j", "p"]);
  expect(calls).toEqual(["pin two"]);
  expect(line("Pinned")).toBeGreaterThanOrEqual(0);
  expect(line("Pinned")).toBeLessThan(line("Repo"));
  expect(y("two")).toBeLessThan(line("Repo"));
  expect(y("one")).toBeGreaterThan(line("Repo"));
  await press(app, ["p"]);
  expect(calls).toEqual(["pin two", "unpin two"]);
  expect(line("Pinned")).toBe(-1);
  expect(y("one")).toBeLessThan(y("two"));
});

it("J and K reorder within Pinned, and j/k walk the displayed order", async () => {
  const { app, y } = await pinnable();
  await press(app, ["p", "j", "p"]);
  expect(y("two")).toBeLessThan(y("one"));
  await press(app, ["J"]);
  expect(y("one")).toBeLessThan(y("two"));
  await press(app, ["G", "\r"]);
  expect(app.lastFrame()).toContain("hello gamma");
});

it("pins from the Command Center and the context menu", async () => {
  const { app, test, calls } = await pinnable();
  await press(app, [":", "Pin workspace", "\r"]);
  expect(calls).toEqual(["pin one"]);
  const row = test.renderer.root.findDescendantById("workspace:one");
  if (!row) throw Error("Missing workspace");
  await test.mockMouse.click(row.x + 2, row.y, 2);
  await settle();
  expect(app.lastFrame()).toContain("Unpin");
  await press(app, ["p"]);
  expect(calls).toEqual(["pin one", "unpin one"]);
  expect(test.renderer.root.findDescendantById("context-pin")).toBeFalsy();
});

it("explains that the daemon needs updating, and hides the menu item", async () => {
  const { app, test, calls } = await pinnable({ supported: false });
  await press(app, ["p"]);
  expect(app.lastFrame()).toContain(PINS_UNSUPPORTED);
  const row = test.renderer.root.findDescendantById("workspace:one");
  if (!row) throw Error("Missing workspace");
  await test.mockMouse.click(row.x + 2, row.y, 2);
  await settle();
  expect(test.renderer.root.findDescendantById("context-pin")).toBeFalsy();
  expect(calls).toEqual([]);
});

it("reports a failed pin on the status line", async () => {
  const { app } = await pinnable({ error: Error("Workspace not found") });
  await press(app, ["p"]);
  expect(app.lastFrame()).toContain("Workspace not found");
});
