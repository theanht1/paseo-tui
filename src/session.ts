import type { PaseoAgent } from "@getpaseo/client";
import type { Connection } from "./connection/connect.js";
import { createAgentsStore } from "./state/agents-store.js";
import { createLabelCatalog } from "./state/label-catalog.js";
import { createAgentPort, createAgentsPort } from "./state/ports.js";
import { createProviderCatalog } from "./state/provider-catalog.js";
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
      projects: connection.projects,
    }),
    connection.management.capabilities,
  );
  const providers = createProviderCatalog(connection.providers);
  const agentsPort = createAgentsPort(
    connection.api,
    providers,
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
  const labels = connection.labels
    ? createLabelCatalog(connection.labels)
    : undefined;
  const status = watchConnection(connection, () => {
    void agents.resync();
    void directory.resync();
    void providers.load();
    void labels?.load();
  });
  /** A timeline store for one of this host's agents. */
  function openTimeline(agent: PaseoAgent) {
    return createTimelineStore(
      createAgentPort(
        connection.api.agents.ref(agent),
        connection.daemon,
        connection.agentFeatures,
      ),
    );
  }
  const timelines = createTimelineRegistry(openTimeline);
  const subagents = connection.subagents
    ? createProviderSubagentStore(connection.subagents)
    : undefined;
  void agents.load();
  void directory.load();
  return {
    agentsPort,
    providers,
    refreshProviders: () => providers.refresh(),
    management,
    clearAttention: connection.daemon.clearAgentAttention,
    async refresh() {
      await Promise.all([agents.resync(), directory.resync()]);
    },
    directory,
    labels,
    terminals: connection.api.terminals,
    terminalStream: connection.terminalStream,
    agents,
    status,
    timelines,
    openTimeline,
    subagents,
    usage,
    history: connection.history,
    workspaceRead: connection.workspaceRead,
    workspacePins: connection.workspacePins,
    schedules: connection.schedules,
    completions: connection.completions,
    directories: connection.directories,
    async close() {
      usage?.close();
      subagents?.close();
      timelines.close();
      status.close();
      await Promise.all([
        agents.close(),
        directory.close(),
        providers.close(),
        labels?.close(),
      ]);
    },
  };
}
