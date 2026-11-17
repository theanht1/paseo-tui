import { describe, expect, it } from "vitest";
import { fileOpen } from "./file-open.js";

const local = { remote: false, home: "/Users/me" };

describe("fileOpen", () => {
  it("edits text and source files in the terminal, including unknown and extensionless ones", () => {
    for (const path of [
      "/repo/src/app.ts",
      "/repo/README.md",
      "/repo/data.json",
      "/repo/Makefile",
      "/repo/.env",
      "/repo/notes.weird",
      "/repo/icon.svg",
    ])
      expect(fileOpen(path, local)).toEqual({ kind: "editor" });
  });
  it("hands images, video, audio, PDFs and office documents to the OS opener", () => {
    for (const path of [
      "/repo/shot.png",
      "/repo/photo.JPEG",
      "/repo/clip.mp4",
      "/repo/talk.mov",
      "/repo/song.mp3",
      "/repo/spec.pdf",
      "/repo/plan.docx",
      "/repo/sheet.xlsx",
    ])
      expect(fileOpen(path, local)).toEqual({ kind: "system", path });
  });
  it("expands a home path for the OS opener", () => {
    expect(fileOpen("~/Desktop/shot.png", local)).toEqual({
      kind: "system",
      path: "/Users/me/Desktop/shot.png",
    });
  });
  it("explains that a non-text file on another machine can't be opened here", () => {
    expect(fileOpen("/repo/shot.png", { ...local, remote: true })).toEqual({
      kind: "unavailable",
      message: "shot.png is not a text file and lives on another machine",
    });
    expect(fileOpen("/repo/app.ts", { ...local, remote: true })).toEqual({
      kind: "editor",
    });
  });
});
