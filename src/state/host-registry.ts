import { join } from "node:path";

/**
 * A daemon the user added. `connection` is any `--host` target (host:port, tcp://…,
 * ssh://…) without credentials; `password` is the daemon's (its PASEO_PASSWORD).
 */
export interface SavedHost {
  connection: string;
  label: string | null;
  password: string | null;
}
/** Takes a `?password=` out of an address (tcp, ws(s), ssh), where it would show and be logged. */
export function splitPassword(connection: string): {
  connection: string;
  password: string | null;
} {
  const trimmed = connection.trim();
  if (!/^(tcp|wss?|ssh):\/\//.test(trimmed))
    return { connection: trimmed, password: null };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { connection: trimmed, password: null };
  }
  const password = url.searchParams.get("password");
  if (password === null) return { connection: trimmed, password: null };
  url.searchParams.delete("password");
  return { connection: url.toString(), password: password || null };
}
function serialize(hosts: readonly SavedHost[]) {
  return `${JSON.stringify(
    {
      hosts: hosts.map(({ password, ...host }) =>
        password ? { ...host, password } : host,
      ),
    },
    null,
    2,
  )}\n`;
}
export interface TextStorage {
  read(): Promise<string | null>;
  write(contents: string): Promise<void>;
}
export interface HostRegistry {
  list(): readonly SavedHost[];
  add(host: SavedHost): Promise<SavedHost>;
}
export function hostsPath(env: NodeJS.ProcessEnv, home: string): string {
  return join(
    env.XDG_CONFIG_HOME || join(home, ".config"),
    "paseo-tui",
    "hosts.json",
  );
}
function parseHosts(text: string): SavedHost[] {
  const parsed: unknown = JSON.parse(text);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("hosts" in parsed) ||
    !Array.isArray(parsed.hosts)
  )
    throw Error('expected { "hosts": [...] }');
  return parsed.hosts.map((entry: unknown, index): SavedHost => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("connection" in entry) ||
      typeof entry.connection !== "string" ||
      !entry.connection.trim()
    )
      throw Error(`hosts[${index}].connection must be a non-empty string`);
    const label =
      "label" in entry && typeof entry.label === "string" && entry.label.trim()
        ? entry.label.trim()
        : null;
    const stored =
      "password" in entry &&
      typeof entry.password === "string" &&
      entry.password
        ? entry.password
        : null;
    const split = splitPassword(entry.connection);
    return {
      connection: split.connection,
      label,
      password: stored ?? split.password,
    };
  });
}
/** Whether saved entry `index` in `text` had `?password=` in its address. */
function carriedPassword(text: string, index: number): boolean {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || !("hosts" in parsed))
    return false;
  const hosts: unknown = parsed.hosts;
  if (!Array.isArray(hosts)) return false;
  const entry: unknown = hosts[index];
  return (
    typeof entry === "object" &&
    entry !== null &&
    "connection" in entry &&
    typeof entry.connection === "string" &&
    splitPassword(entry.connection).password !== null
  );
}
/** Hosts saved by this client (not the daemon's connected hosts), kept in `source`. */
export async function loadHostRegistry(
  storage: TextStorage,
  source: string,
): Promise<HostRegistry> {
  const text = await storage.read();
  let hosts: SavedHost[] = [];
  if (text !== null) {
    try {
      hosts = parseHosts(text);
    } catch (error) {
      throw Error(
        `Invalid hosts file ${source}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    // Rewrite only a file whose addresses carried passwords, so they leave the address.
    if (hosts.some((_, index) => carriedPassword(text, index)))
      await storage.write(serialize(hosts));
  }
  return {
    list: () => hosts,
    async add(host) {
      const split = splitPassword(host.connection);
      const { connection } = split;
      if (!connection) throw Error("Enter a host address");
      if (hosts.some((saved) => saved.connection === connection))
        throw Error(`${connection} is already saved`);
      const saved: SavedHost = {
        connection,
        label: host.label?.trim() || null,
        password: host.password || split.password,
      };
      const next = [...hosts, saved];
      await storage.write(serialize(next));
      hosts = next;
      return saved;
    },
  };
}
