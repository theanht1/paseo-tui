import type { Connection } from "./connection/connect.js";
import { createAgentsStore } from "./state/agents-store.js";
import { createAgentPort, createAgentsPort } from "./state/ports.js";
import { createProviderSubagentStore } from "./state/provider-subagents.js";
import { createTimelineRegistry } from "./state/timeline-registry.js";
import { createTimelineStore } from "./state/timeline-store.js";
import { createUsageStore } from "./state/usage-store.js";
import { watchConnection } from "./ui/connection-status.js";
import {
  createWorkspaceActions,
  managementApi,
} from "./ui/workspace/workspace-actions.js";
import { createWorkspaceDirectory } from "./ui/workspace/workspace-directory.js";

export function createSession(connection: Connection) {
  const management = createWorkspaceActions(
    managementApi(connection.api, {
      renameAgent: connection.daemon.renameAgent,
      renameTerminal: connection.management.renameTerminal,
      branches: connection.git.branches,
    }),
    connection.management.capabilities,
  );
  const agentsPort = createAgentsPort(
    connection.api,
    connection.management.capabilities.thinking,
  );
  const agents = createAgentsStore(agentsPort);
  const directory = createWorkspaceDirectory({
    ...connection.api,
    terminals: connection.terminalList,
  });
  const usage = connection.usage
    ? createUsageStore(connection.usage)
    : undefined;
  const status = watchConnection(connection, () => {
    void agents.resync();
    void directory.resync();
  });
  const timelines = createTimelineRegistry((agent) =>
    createTimelineStore(
      createAgentPort(
        connection.api.agents.ref(agent),
        connection.daemon,
        connection.agentFeatures,
      ),
    ),
  );
  const subagents = connection.subagents
    ? createProviderSubagentStore(connection.subagents)
    : undefined;
  void agents.load();
  void directory.load();
  return {
    agentsPort,
    management,
    clearAttention: connection.daemon.clearAgentAttention,
    async refresh() {
      await Promise.all([agents.resync(), directory.resync()]);
    },
    directory,
    terminals: connection.api.terminals,
    terminalStream: connection.terminalStream,
    agents,
    status,
    timelines,
    subagents,
    usage,
    schedules: connection.schedules,
    async close() {
      usage?.close();
      subagents?.close();
      timelines.close();
      status.close();
      await Promise.all([agents.close(), directory.close()]);
    },
  };
}
