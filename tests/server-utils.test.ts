import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atomicWrite, isValidId, readJson, stripNullValues } from "../server/utils";

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

describe("atomicWrite", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "utils-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes and reads back content", () => {
    const filePath = path.join(tmpDir, "test.json");
    atomicWrite(filePath, '{"hello":"world"}');
    expect(fs.readFileSync(filePath, "utf-8")).toBe('{"hello":"world"}');
  });

  it("overwrites existing file", () => {
    const filePath = path.join(tmpDir, "test.json");
    atomicWrite(filePath, "first");
    atomicWrite(filePath, "second");
    expect(fs.readFileSync(filePath, "utf-8")).toBe("second");
  });
});

describe("readJson", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "utils-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses valid JSON", () => {
    const filePath = path.join(tmpDir, "data.json");
    fs.writeFileSync(filePath, '{"key":"value"}');
    expect(readJson(filePath, null)).toEqual({ key: "value" });
  });

  it("returns fallback on missing file", () => {
    const filePath = path.join(tmpDir, "missing.json");
    expect(readJson(filePath, [])).toEqual([]);
  });

  it("returns fallback on corrupt file", () => {
    const filePath = path.join(tmpDir, "bad.json");
    fs.writeFileSync(filePath, "not valid json {{{");
    expect(readJson(filePath, "fallback")).toBe("fallback");
  });
});
