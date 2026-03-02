import { describe, expect, it } from "vitest";
import { processTemplate, scanPortVars } from "../server/port-allocator";

describe("scanPortVars", () => {
  it("finds __PORT_N__ variables", () => {
    expect(scanPortVars("start server on __PORT_1__ and __PORT_2__")).toEqual([
      "__PORT_1__",
      "__PORT_2__",
    ]);
  });

  it("deduplicates vars", () => {
    expect(scanPortVars("__PORT_1__ and __PORT_1__")).toEqual(["__PORT_1__"]);
  });

  it("skips comment lines", () => {
    expect(scanPortVars("# __PORT_1__ is a comment\n__PORT_2__ is real")).toEqual(["__PORT_2__"]);
  });

  it("returns empty for no matches", () => {
    expect(scanPortVars("no ports here")).toEqual([]);
  });
});

describe("processTemplate", () => {
  it("replaces port vars with real numbers", () => {
    const result = processTemplate("server on __PORT_1__", { __PORT_1__: 3456 });
    expect(result).toBe("server on 3456");
  });

  it("preserves comment lines", () => {
    const result = processTemplate("# __PORT_1__ docs\n__PORT_1__ real", { __PORT_1__: 3456 });
    expect(result).toBe("# __PORT_1__ docs\n3456 real");
  });

  it("handles multiple vars", () => {
    const result = processTemplate("__PORT_1__ and __PORT_2__", {
      __PORT_1__: 3000,
      __PORT_2__: 4000,
    });
    expect(result).toBe("3000 and 4000");
  });
});
