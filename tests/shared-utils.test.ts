import { describe, expect, it } from "vitest";
import { slugify } from "../shared/utils";

describe("slugify", () => {
  it("lowercases and replaces spaces with dashes", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("removes diacritics", () => {
    expect(slugify("café résumé")).toBe("cafe-resume");
  });

  it("strips leading/trailing dashes", () => {
    expect(slugify("---hello---")).toBe("hello");
  });

  it("collapses multiple non-alphanumeric chars", () => {
    expect(slugify("a!!b@@c")).toBe("a-b-c");
  });

  it("truncates to 60 chars", () => {
    const long = "a".repeat(100);
    expect(slugify(long).length).toBe(60);
  });

  it("returns 'conversation' for empty input", () => {
    expect(slugify("")).toBe("conversation");
    expect(slugify("!!!")).toBe("conversation");
  });
});
