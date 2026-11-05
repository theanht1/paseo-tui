import { expect, it } from "vitest";
import { confirmQuit } from "./quit-confirmation.js";

it("requires two interrupts within two seconds and re-arms after expiry", () => {
  expect(confirmQuit(null, 100)).toEqual({ quit: false, deadline: 2100 });
  expect(confirmQuit(2100, 2099).quit).toBe(true);
  expect(confirmQuit(2100, 2100)).toEqual({ quit: false, deadline: 4100 });
});
