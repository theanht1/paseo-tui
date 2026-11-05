import { expect, it } from "vitest";
import { createPathVerifier } from "./verify.js";

function fakeDirectories(
  tree: Record<string, Record<string, "file" | "directory">>,
) {
  const listed: string[] = [];
  return {
    listed,
    port: {
      async list(directory: string) {
        listed.push(directory);
        const entries = tree[directory];
        if (!entries) throw Error("ENOENT");
        return Object.entries(entries).map(([name, kind]) => ({ name, kind }));
      },
    },
  };
}

it("checks existence through one cached listing per directory", async () => {
  const { listed, port } = fakeDirectories({
    "/repo/src": { "a.ts": "file", "b.ts": "file", lib: "directory" },
  });
  const verifier = createPathVerifier(port);
  let notified = 0;
  verifier.subscribe(() => notified++);
  expect(verifier.status("/repo/src/a.ts")).toBe("pending");
  verifier.request([
    "/repo/src/a.ts",
    "/repo/src/b.ts",
    "/repo/src/lib",
    "/repo/src/c.ts",
  ]);
  verifier.request(["/repo/src/a.ts"]);
  await verifier.settled();
  expect(listed).toEqual(["/repo/src"]);
  expect(verifier.status("/repo/src/a.ts")).toBe("file");
  expect(verifier.status("/repo/src/lib")).toBe("missing");
  expect(verifier.status("/repo/src/c.ts")).toBe("missing");
  expect(notified).toBeGreaterThan(0);
  verifier.request(["/repo/src/b.ts"]);
  await verifier.settled();
  expect(listed).toEqual(["/repo/src"]);
});

it("treats an unreadable directory as missing and keeps ~ paths for the daemon to expand", async () => {
  const { listed, port } = fakeDirectories({
    "~/notes": { "todo.md": "file" },
  });
  const verifier = createPathVerifier(port);
  verifier.request(["/nope/x.ts", "~/notes/todo.md"]);
  await verifier.settled();
  expect(listed.sort()).toEqual(["/nope", "~/notes"]);
  expect(verifier.status("/nope/x.ts")).toBe("missing");
  expect(verifier.status("~/notes/todo.md")).toBe("file");
});
