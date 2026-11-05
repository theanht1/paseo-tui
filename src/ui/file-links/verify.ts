import { posix } from "node:path";
import type { DirectoryPort } from "../../connection/ports.js";
import { createEmitter } from "../../state/emitter.js";

export type PathStatus = "file" | "missing" | "pending";
const MAX_DIRECTORIES = 500;

/** Verifies paths exist on the daemon host with one cached listing per directory. */
export function createPathVerifier(port: DirectoryPort) {
  const emitter = createEmitter();
  const listings = new Map<string, ReadonlySet<string> | "pending">();
  const inflight = new Set<Promise<void>>();
  let version = 0;
  function split(path: string) {
    return { directory: posix.dirname(path), name: posix.basename(path) };
  }
  function load(directory: string) {
    listings.set(directory, "pending");
    if (listings.size > MAX_DIRECTORIES) {
      const oldest = listings.keys().next().value;
      if (oldest !== undefined) listings.delete(oldest);
    }
    const work: Promise<void> = port.list(directory).then(
      (entries) => {
        listings.set(
          directory,
          new Set(
            entries
              .filter((entry) => entry.kind === "file")
              .map((entry) => entry.name),
          ),
        );
      },
      () => {
        listings.set(directory, new Set());
      },
    );
    const tracked = work.finally(() => {
      inflight.delete(tracked);
      version++;
      emitter.notify();
    });
    inflight.add(tracked);
  }
  return {
    subscribe: emitter.subscribe,
    getSnapshot: () => version,
    status(path: string): PathStatus {
      const { directory, name } = split(path);
      const listing = listings.get(directory);
      if (listing === undefined || listing === "pending") return "pending";
      return listing.has(name) ? "file" : "missing";
    },
    request(paths: readonly string[]) {
      for (const path of paths) {
        const { directory } = split(path);
        if (!listings.has(directory)) load(directory);
      }
    },
    async settled() {
      while (inflight.size) await Promise.all(inflight);
    },
  };
}
export type PathVerifier = ReturnType<typeof createPathVerifier>;
