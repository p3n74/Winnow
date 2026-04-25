import { describe, expect, it } from "vitest";
import { parseDotenvContent } from "../src/config/dotenvFile.js";

describe("dotenvFile", () => {
  it("parses quoted and plain values", () => {
    const raw = `
# c
FOO=bar
BAZ="x y"
Q='a'
`;
    expect(parseDotenvContent(raw)).toEqual({ FOO: "bar", BAZ: "x y", Q: "a" });
  });
});
