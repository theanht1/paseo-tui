import { createContext } from "react";
import type { FileLink } from "./links.js";
import type { PathVerifier } from "./verify.js";

export interface FileLinks {
  verifier: PathVerifier;
  /** Opens the link in an editor tab of the agent's workspace. */
  open(agentId: string, link: FileLink): void;
  notify(text: string): void;
}
export const FileLinksContext = createContext<FileLinks | null>(null);
