import type { TestProject } from "vitest/node";
import { startTestDaemon } from "./daemon-harness.js";

declare module "vitest" {
  export interface ProvidedContext {
    daemonHost: string;
  }
}

export default async function setup(project: TestProject) {
  const daemon = await startTestDaemon();
  project.provide("daemonHost", daemon.host);
  return () => daemon.stop();
}
