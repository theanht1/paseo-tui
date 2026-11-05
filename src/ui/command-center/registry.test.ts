import { describe, expect, it } from "vitest";
import { at } from "../../test/at.js";
import {
  type CommandItem,
  createCommandRegistry,
  rankCommands,
} from "./registry.js";

function item(id: string, fields: Partial<CommandItem> = {}): CommandItem {
  return { id, title: id, group: "Agents", run(): undefined {}, ...fields };
}
describe("command ranking", () => {
  it("prefers title prefixes to keyword matches", () => {
    expect(
      rankCommands(
        [item("other", { keywords: ["alpha"] }), item("Alpha agent")],
        "alp",
      ).map((r) => r.item.id),
    ).toEqual(["Alpha agent", "other"]);
  });
  it("requires every query token across fields", () => {
    expect(
      rankCommands(
        [item("Alpha", { subtitle: "codex" }), item("Alpha other")],
        "alp cod",
      ).map((r) => r.item.id),
    ).toEqual(["Alpha"]);
  });
  it("breaks ties by recency", () => {
    expect(
      at(
        rankCommands(
          [
            item("old", { title: "Alpha", recency: 1 }),
            item("new", { title: "Alpha", recency: 2 }),
          ],
          "alpha",
        ),
        0,
      ).item.id,
    ).toBe("new");
  });
  it("unregisters sources", () => {
    const registry = createCommandRegistry();
    const remove = registry.register({
      id: "test",
      items: () => [item("Alpha")],
    });
    expect(registry.items()).toHaveLength(1);
    remove();
    expect(registry.items()).toEqual([]);
  });
  it("groups an empty query with recency within each group", () => {
    expect(
      rankCommands(
        [
          item("pane", { group: "Actions" }),
          item("old"),
          item("new", { recency: 1 }),
        ],
        "",
      ).map((r) => r.item.id),
    ).toEqual(["new", "old", "pane"]);
  });
  it("highlights scattered subsequence matches", () => {
    expect(
      at(rankCommands([item("paseo-babysit")], "pasbab"), 0).titleRanges,
    ).toEqual([
      { start: 0, length: 3 },
      { start: 6, length: 3 },
    ]);
  });
});
