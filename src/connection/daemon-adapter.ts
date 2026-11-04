import type { createHostClient } from "@getpaseo/client/node";

type Daemon = Pick<
  ReturnType<typeof createHostClient>,
  "cancelAgent" | "setAgentMode" | "setAgentModel" | "updateAgent"
>;
export interface DaemonAdapter {
  cancelAgent(agentId: string): Promise<void>;
  setAgentMode(agentId: string, modeId: string): Promise<string | null>;
  setAgentModel(agentId: string, modelId: string): Promise<void>;
  renameAgent(agentId: string, name: string): Promise<void>;
}
export function createDaemonAdapter(daemon: Daemon): DaemonAdapter {
  return {
    cancelAgent: (id) => daemon.cancelAgent(id),
    async setAgentMode(id, modeId) {
      const notice = await daemon.setAgentMode(id, modeId);
      if (notice?.type === "error") throw new Error(notice.message);
      return notice?.message ?? null;
    },
    setAgentModel: (id, modelId) => daemon.setAgentModel(id, modelId),
    async renameAgent(id, name) {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Name can't be empty");
      await daemon.updateAgent(id, { name: trimmed });
    },
  };
}
