import type { AgentPermissionRequest } from "@getpaseo/protocol/agent-types";
import { describe, expect, it } from "vitest";
import {
  type FakeAgent,
  settle,
  settleUntil,
  setup,
} from "../test/app-harness.js";
import { agent } from "../test/fixtures.js";

const plan: AgentPermissionRequest = {
  id: "plan",
  provider: "claude",
  name: "ExitPlanMode",
  kind: "plan",
  input: { plan: "# Proposed\n\n- Append **Hello** to README.md" },
  metadata: { toolUseId: "tool-plan" },
};
const question: AgentPermissionRequest = {
  id: "ask",
  provider: "claude",
  name: "AskUserQuestion",
  kind: "question",
  input: {
    questions: [
      {
        question: "Which database?",
        header: "Database",
        options: [{ label: "Postgres" }],
      },
    ],
  },
};

async function open(request: AgentPermissionRequest) {
  const result = await setup(
    [agent("alpha", { pendingPermissions: [request] })],
    30,
  );
  result.app.stdin.write("\r");
  await settle();
  const port = result.ports.get("alpha");
  if (!port) throw new Error("alpha timeline was not opened");
  return { ...result, port };
}
async function type(
  app: Awaited<ReturnType<typeof setup>>["app"],
  ...inputs: string[]
) {
  for (const input of inputs) {
    app.stdin.write(input);
    await settle();
  }
}
/** What the daemon does after a steer: deny the plan, keep it as a rejected row. */
function rejectPlan(port: FakeAgent) {
  port.handler?.({
    agentId: "alpha",
    timestamp: "2026-11-03T00:00:00Z",
    event: {
      type: "permission_resolved",
      provider: "claude",
      requestId: "plan",
      resolution: { behavior: "deny" },
    },
  });
  port.handler?.({
    agentId: "alpha",
    epoch: "epoch",
    seq: 4,
    timestamp: "2026-11-03T00:00:00Z",
    event: {
      type: "timeline",
      provider: "claude",
      item: {
        type: "tool_call",
        callId: "tool-plan",
        name: "plan_approval",
        status: "completed",
        error: null,
        detail: { type: "plan", text: "# Proposed\n\n- Append Hello" },
        metadata: { approved: false },
      },
    },
  });
}

describe("steering instead of answering", () => {
  it("renders the plan as markdown and steers with m instead of answering", async () => {
    const { app, port } = await open(plan);
    await settleUntil(() => app.lastFrame(), "README.md");
    const frame = app.lastFrame();
    expect(frame).toContain("Plan");
    expect(frame).toContain("Append Hello to README.md");
    expect(frame).not.toContain("**Hello**");
    expect(frame).toContain("m message");
    await type(app, "m");
    expect(app.lastFrame()).toContain("Message ›");
    // Keys that answer the card are text while the message field is open.
    await type(app, "n", "o", " ", "y", "e", "t");
    expect(app.lastFrame()).toContain("Message › no yet▌");
    await type(app, "\r");
    expect(port.steered).toEqual(["no yet"]);
    expect(port.sent).toEqual([]);
    expect(port.responses).toEqual([]);
    rejectPlan(port);
    await settleUntil(() => app.lastFrame(), "Rejected plan");
    expect(app.lastFrame()).toContain("Rejected plan");
    expect(app.lastFrame()).not.toContain("Append Hello");
    await type(app, "}", "o");
    await settleUntil(() => app.lastFrame(), "Append Hello");
    expect(app.lastFrame()).toContain("Append Hello");
  });

  it("Esc closes the message field and keeps the card answerable", async () => {
    const { app, port } = await open(plan);
    await type(app, "m", "x");
    expect(app.lastFrame()).toContain("Message › x");
    app.stdin.write("\u001b");
    await new Promise((resolve) => setTimeout(resolve, 40));
    await settle();
    expect(app.lastFrame()).not.toContain("Message ›");
    await type(app, "y");
    expect(port.steered).toEqual([]);
    expect(port.responses).toEqual([
      { id: "plan", response: { behavior: "allow" } },
    ]);
  });

  it("steers from a question form", async () => {
    const { app, port } = await open(question);
    expect(app.lastFrame()).toContain("m message");
    await type(app, "m", "s", "k", "i", "p", "\r");
    expect(port.steered).toEqual(["skip"]);
    expect(port.responses).toEqual([]);
  });
});
