import { expect, test } from "vitest";
import { createTheme, THEME_COLOR_FIELDS } from "./theme.js";

test("overrides replace theme colors, status, syntax and headings", () => {
  const theme = createTheme(
    {},
    {
      accent: "#ff8800",
      status: { running: "#00ff00" },
      syntax: { keyword: "#123456" },
      heading: ["#abcdef"],
    },
  );
  expect(theme.accent).toBe("#ff8800");
  expect(theme.fg).toBe(createTheme({}).fg);
  expect(theme.status.running).toBe("#00ff00");
  expect(theme.status.idle).toBe(createTheme({}).status.idle);
  expect(theme.syntax.keyword).toBe("#123456");
  expect(theme.heading).toEqual([
    "#abcdef",
    ...createTheme({}).heading.slice(1),
  ]);
});

test("NO_COLOR wins over overrides", () => {
  const theme = createTheme(
    { NO_COLOR: "1" },
    { accent: "#ff8800", status: { running: "#00ff00" }, heading: ["#abcdef"] },
  );
  expect(theme.accent).toBe("");
  expect(theme.status.running).toBe("");
  expect(theme.heading[0]).toBe("");
});

test("the color field list covers every top-level color of the theme", () => {
  const theme = createTheme({});
  expect([...THEME_COLOR_FIELDS].sort()).toEqual(
    Object.entries(theme)
      .filter(([, value]) => typeof value === "string")
      .map(([key]) => key)
      .sort(),
  );
});
