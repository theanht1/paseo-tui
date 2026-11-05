import { expect, test } from "vitest";
import { agentAge } from "./agent-display.js";

test("shows compact elapsed time and clamps future updates", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  expect(agentAge("2026-11-04T11:59:45Z", now)).toBe("15s");
  expect(agentAge("2026-11-04T11:58:00Z", now)).toBe("2m");
  expect(agentAge("2026-11-04T10:00:00Z", now)).toBe("2h");
  expect(agentAge("2026-11-02T12:00:00Z", now)).toBe("2d");
  expect(agentAge("2026-11-05T12:00:00Z", now)).toBe("0s");
});
