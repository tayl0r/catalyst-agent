import { describe, expect, it } from "vitest";
import { isValidId, stripNullValues } from "../server/utils";

describe("isValidId", () => {
  it("accepts valid UUIDs", () => {
    expect(isValidId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("rejects non-UUID strings", () => {
    expect(isValidId("not-a-uuid")).toBe(false);
    expect(isValidId("")).toBe(false);
    expect(isValidId("550e8400-e29b-41d4-a716")).toBe(false);
  });
});

describe("stripNullValues", () => {
  it("removes null values from objects", () => {
    expect(stripNullValues({ a: 1, b: null, c: "test" })).toEqual({ a: 1, c: "test" });
  });

  it("recursively strips null from nested objects", () => {
    expect(stripNullValues({ a: { b: null, c: 1 } })).toEqual({ a: { c: 1 } });
  });

  it("filters null from arrays", () => {
    expect(stripNullValues([1, null, 3])).toEqual([1, 3]);
  });

  it("returns undefined for null input", () => {
    expect(stripNullValues(null)).toBeUndefined();
  });

  it("passes through primitives", () => {
    expect(stripNullValues(42)).toBe(42);
    expect(stripNullValues("hello")).toBe("hello");
    expect(stripNullValues(true)).toBe(true);
  });
});
