import { randomUUID } from "node:crypto";
import {
  type ConnectionState,
  createPaseoApi,
  type PaseoApi,
} from "@getpaseo/client";
import { createHostClient, parseHostTarget } from "@getpaseo/client/node";
import packageJson from "../../package.json" with { type: "json" };
import { readLocalCredentialForTarget } from "./local-credential.js";
import { type HostTarget, resolveListen } from "./target.js";

export interface Connection {
  api: PaseoApi;
  cancelAgent(agentId: string): Promise<void>;
  label: string;
  onConnectionState(cb: (state: ConnectionState) => void): () => void;
  close(): Promise<void>;
}

export async function connect(target: HostTarget): Promise<Connection> {
  const connection =
    target.kind === "home" ? resolveListen(target.home) : target.connection;
  const parsed = parseHostTarget(connection);
  const label =
    target.kind === "home"
      ? `local (${parsed.description.replace(/^tcp:\/\//, "")})`
      : parsed.description;
  const password = parsed.password || process.env.PASEO_PASSWORD;
  const daemon = createHostClient(connection, {
    clientId: `paseo-tui-${randomUUID()}`,
    clientType: "cli",
    appVersion: packageJson.version,
    ...(password ? { password } : {}),
    ...(!password && target.kind === "home"
      ? {
          localCredential: () =>
            readLocalCredentialForTarget(target.home, connection) ?? undefined,
        }
      : {}),
    reconnect: { enabled: true },
  });
  // Startup must fail promptly; retries belong to an established TUI session.
  const unsubscribe = daemon.subscribeConnectionStatus((state) => {
    if (state.status === "disconnected") daemon.setReconnectEnabled(false);
  });
  try {
    await daemon.connect();
  } catch (error) {
    const authFailure = daemon.authFailureReason;
    await daemon.close();
    if (authFailure === "password_required") {
      throw new Error(
        "Paseo requires a password. Set PASEO_PASSWORD and retry.",
      );
    }
    if (authFailure === "incorrect_password") {
      throw new Error(
        "Paseo rejected the password. Check PASEO_PASSWORD and retry.",
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    const detail = /ECONNREFUSED|connection refused/i.test(message)
      ? "connection refused. Start Paseo, or check --host."
      : message;
    throw new Error(
      `Cannot connect to Paseo at ${label}: ${detail}`.replace(/\s+/g, " "),
    );
  } finally {
    unsubscribe();
  }
  return {
    api: createPaseoApi(daemon),
    label,
    cancelAgent: (agentId) => daemon.cancelAgent(agentId),
    onConnectionState: (cb) => daemon.subscribeConnectionStatus(cb),
    close: () => daemon.close(),
  };
}
