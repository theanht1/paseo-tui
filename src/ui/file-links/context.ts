import { createContext } from "react";
import type { ChatLink } from "./links.js";
import type { PathVerifier } from "./verify.js";

export interface FileLinks {
  verifier: PathVerifier;
  /** Opens a file in an editor tab of the agent's workspace, a URL in the local browser. */
  open(agentId: string, link: ChatLink): void;
  notify(text: string): void;
}
export const FileLinksContext = createContext<FileLinks | null>(null);
