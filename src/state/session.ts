import type { Connection } from "../connection/connect.js";
import { watchConnection } from "../ui/connection-status.js";
import { createAgentsStore } from "./agents-store.js";
import { createAgentPort, createAgentsPort } from "./ports.js";
import { createTimelineRegistry } from "./timeline-registry.js";
import { createTimelineStore } from "./timeline-store.js";

export function createSession(connection: Connection) {
  const agentsPort = createAgentsPort(connection.api);
  const agents = createAgentsStore(agentsPort);
  const status = watchConnection(connection, () => void agents.resync());
  const timelines = createTimelineRegistry((agent) =>
    createTimelineStore(
      createAgentPort(connection.api.agents.ref(agent), connection.daemon),
    ),
  );
  void agents.load();
  return {
    agentsPort,
    agents,
    status,
    timelines,
    async close() {
      timelines.close();
      status.close();
      await agents.close();
    },
  };
}
