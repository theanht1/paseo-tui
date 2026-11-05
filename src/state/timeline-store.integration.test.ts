import { afterEach, beforeEach, expect, inject, it } from "vitest";
import { type Connection, connect } from "../connection/connect.js";
import { createSession } from "../session.js";
import { createAgentPort } from "./ports.js";
import { createTimelineStore } from "./timeline-store.js";

let connection: Connection;
let session: ReturnType<typeof createSession>;
const created: string[] = [];

beforeEach(async () => {
  connection = await connect({
    kind: "host",
    connection: inject("daemonHost"),
  });
  session = createSession(connection);
});
afterEach(async () => {
  for (const id of created.splice(0))
    await connection.api.agents.ref(id).archive();
  await session.close();
  await connection.close();
});

it("searches the daemon's history, lists prompts and seeds a fork from one", async () => {
  const agent = await session.agentsPort.create({
    provider: "mock",
    model: "ten-second-stream",
    modeId: null,
    cwd: process.cwd(),
    title: "History features",
    prompt: "find the haystack needle",
  });
  created.push(agent.id);
  const store = createTimelineStore(
    createAgentPort(
      connection.api.agents.ref(agent),
      connection.daemon,
      connection.agentFeatures,
    ),
  );
  try {
    await store.open();
    const { search, prompts, fork } = store;
    if (!search || !prompts || !fork)
      throw Error("Daemon lacks history search, prompt index or fork context");
    await expect
      .poll(async () => (await prompts()).prompts.length, { timeout: 10000 })
      .toBe(1);
    const index = await prompts();
    const [prompt] = index.prompts;
    if (!prompt) throw Error("missing prompt");
    expect(prompt.preview).toBe("find the haystack needle");
    const found = await search.find("haystack needle");
    expect(found.seqs).toContain(prompt.seq);
    expect(await fork({ epoch: index.epoch, seq: prompt.seq }, false)).toEqual({
      text: "find the haystack needle",
      attachment: null,
    });
  } finally {
    store.close();
  }
}, 30000);
