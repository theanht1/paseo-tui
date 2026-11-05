import { describe, expect, it } from "vitest";
import { toBlocks } from "../timeline/blocks.js";
import { chatFiles, linkifyMarkdown, timelineLinks } from "./links.js";

function tool(
  callId: string,
  detail: {
    type: "read" | "edit" | "write";
    filePath: string;
    offset?: number;
  },
) {
  return {
    type: "tool_call" as const,
    callId,
    name: detail.type,
    status: "completed" as const,
    error: null,
    detail,
  };
}
const blocks = toBlocks(
  [
    { type: "user_message" as const, text: "look at user/only.ts" },
    tool("r", { type: "read", filePath: "/repo/src/read.ts", offset: 40 }),
    {
      type: "assistant_message" as const,
      text: "Changed `src/a.ts:12` and see https://x.dev/b.ts",
    },
    tool("e", { type: "edit", filePath: "/repo/src/edit.ts" }),
    {
      type: "assistant_message" as const,
      text: "\n\nAlso ~/notes/n.md and src/a.ts again.",
    },
  ].map((item, index) => ({ seq: index + 1, item })),
);

describe("timelineLinks", () => {
  it("takes explicit tool paths as verified and assistant mentions as candidates", () => {
    const links = timelineLinks(blocks, "/repo");
    expect(
      links.map((link) => [link.path, link.line, link.source, link.raw]),
    ).toEqual([
      ["/repo/src/read.ts", 40, "tool", "/repo/src/read.ts"],
      ["/repo/src/a.ts", 12, "text", "src/a.ts:12"],
      ["/repo/src/edit.ts", null, "tool", "/repo/src/edit.ts"],
      ["~/notes/n.md", null, "text", "~/notes/n.md"],
      ["/repo/src/a.ts", null, "text", "src/a.ts"],
    ]);
  });
});

describe("chatFiles", () => {
  it("lists existing files most recent first, once per path and line", () => {
    const links = timelineLinks(blocks, "/repo");
    const exists = (path: string) => path !== "~/notes/n.md";
    expect(
      chatFiles(
        links,
        (link) => link.source === "tool" || exists(link.path),
      ).map((link) => `${link.path}:${link.line ?? ""}`),
    ).toEqual([
      "/repo/src/a.ts:",
      "/repo/src/edit.ts:",
      "/repo/src/a.ts:12",
      "/repo/src/read.ts:40",
    ]);
  });
});

describe("linkifyMarkdown", () => {
  const isFile = (path: string) => path.startsWith("/repo/src/");
  it("turns existing paths and path-only code spans into self-labelled links", () => {
    expect(
      linkifyMarkdown(
        "Edit src/a.ts:3, `src/b.ts` and `run src/c.ts`; not lib/x.ts.",
        "/repo",
        isFile,
      ),
    ).toBe(
      "Edit [src/a.ts:3](src/a.ts:3), [src/b.ts](src/b.ts) and `run src/c.ts`; not lib/x.ts.",
    );
  });
  it("leaves fenced code, existing links, autolinks and URLs alone", () => {
    const text =
      "```ts\nimport 'src/a.ts'\n```\n[src/a.ts](https://x) <https://x/src/a.ts> https://y/src/a.ts\n~~~\nsrc/b.ts\n~~~\nsrc/b.ts";
    expect(linkifyMarkdown(text, "/repo", isFile)).toBe(
      "```ts\nimport 'src/a.ts'\n```\n[src/a.ts](https://x) <https://x/src/a.ts> https://y/src/a.ts\n~~~\nsrc/b.ts\n~~~\n[src/b.ts](src/b.ts)",
    );
  });
  it("skips names markdown would read as emphasis", () => {
    expect(linkifyMarkdown("src/__init__.py", "/repo", isFile)).toBe(
      "src/__init__.py",
    );
  });
});

describe("fileResolver", () => {
  it("trusts tool paths, asks the verifier for text mentions and resolves screen mentions", async () => {
    const { fileResolver } = await import("./links.js");
    const { findPathMentions } = await import("./detect.js");
    const resolver = fileResolver(
      timelineLinks(blocks, "/repo"),
      "/repo",
      (path) => path === "/repo/src/a.ts",
    );
    expect(resolver.isFile("/repo/src/read.ts")).toBe(true);
    expect(resolver.isFile("/repo/src/a.ts")).toBe(true);
    expect(resolver.isFile("~/notes/n.md")).toBe(false);
    const [mention] = findPathMentions("at src/a.ts:9:2");
    if (!mention) throw Error("no mention");
    expect(resolver.resolve(mention)).toEqual({
      path: "/repo/src/a.ts",
      line: 9,
      col: 2,
      raw: "src/a.ts:9:2",
      source: "text",
    });
    expect(resolver.files().map((link) => link.raw)).toEqual([
      "src/a.ts",
      "/repo/src/edit.ts",
      "src/a.ts:12",
      "/repo/src/read.ts",
    ]);
  });
});
