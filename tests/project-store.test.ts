import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expandTilde } from "../server/project-store";

describe("expandTilde", () => {
  const home = os.homedir();

  it("expands ~/path to homedir/path", () => {
    expect(expandTilde("~/projects")).toBe(path.join(home, "projects"));
  });

  it("expands ~ alone to homedir", () => {
    expect(expandTilde("~")).toBe(home);
  });

  it("passes through absolute paths unchanged", () => {
    expect(expandTilde("/usr/local/bin")).toBe("/usr/local/bin");
  });

  it("passes through relative paths unchanged", () => {
    expect(expandTilde("relative/path")).toBe("relative/path");
  });
});
