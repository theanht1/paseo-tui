import { describe, expect, it } from "vitest";
import type {
  CommandListSource,
  CompletionPort,
  SlashCommand,
} from "../../connection/ports.js";
import { cachedCommands } from "./command-cache.js";

const clear: SlashCommand = {
  name: "clear",
  description: "",
  argumentHint: "",
  kind: "command",
};
function port() {
  const requests: CommandListSource[] = [];
  const failures: Error[] = [];
  const inner: CompletionPort = {
    async commands(source) {
      requests.push(source);
      const failure = failures.shift();
      if (failure) throw failure;
      return [clear];
    },
    async files() {
      return [];
    },
  };
  return { inner, requests, failures };
}
const agent = (agentId: string): CommandListSource => ({
  kind: "agent",
  agentId,
});

describe("cachedCommands", () => {
  it("asks the daemon once per agent, even for concurrent callers", async () => {
    const { inner, requests } = port();
    const cached = cachedCommands(inner);
    await Promise.all([
      cached.commands(agent("a")),
      cached.commands(agent("a")),
    ]);
    await cached.commands(agent("a"));
    await cached.commands(agent("b"));
    expect(requests).toEqual([agent("a"), agent("b")]);
  });
  it("fetches again after a new completion session opens, picking up changes", async () => {
    const { inner, requests } = port();
    const cached = cachedCommands(inner);
    expect(await cached.commands(agent("a"))).toEqual([clear]);
    cached.opened?.(agent("a"));
    await cached.commands(agent("a"));
    expect(requests).toHaveLength(2);
  });
  it("shares a request that is still in flight with a session that opens", async () => {
    const { inner, requests } = port();
    const cached = cachedCommands(inner);
    const first = cached.commands(agent("a"));
    cached.opened?.(agent("a"));
    await Promise.all([first, cached.commands(agent("a"))]);
    expect(requests).toHaveLength(1);
  });
  it("retries after a failure", async () => {
    const { inner, requests, failures } = port();
    failures.push(new Error("offline"));
    const cached = cachedCommands(inner);
    await expect(cached.commands(agent("a"))).rejects.toThrow("offline");
    expect(await cached.commands(agent("a"))).toEqual([clear]);
    expect(requests).toHaveLength(2);
  });
  it("does not cache draft lists, which depend on the provider settings", async () => {
    const { inner, requests } = port();
    const cached = cachedCommands(inner);
    const draft: CommandListSource = {
      kind: "draft",
      config: { provider: "claude", cwd: "/x" },
    };
    await cached.commands(draft);
    await cached.commands(draft);
    expect(requests).toHaveLength(2);
  });
});
