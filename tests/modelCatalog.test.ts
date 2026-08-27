import { describe, expect, it } from "vitest";
import { isEmptyCursorModelsListing, parseCursorModelsOutput } from "../src/cursor/modelCatalog.js";

describe("parseCursorModelsOutput", () => {
  it("parses id-label rows and pins Auto first", () => {
    const options = parseCursorModelsOutput(`Available models

gpt-5.5 - GPT-5.5
auto - Auto (current, default)
composer-2.5 - Composer 2.5
Tip: use --model <id>
`);
    expect(options.map((item) => item.id)).toEqual(["auto", "gpt-5.5", "composer-2.5"]);
    expect(options[0]?.label).toBe("Auto");
  });

  it("treats an empty account listing as no models", () => {
    expect(isEmptyCursorModelsListing("No models available for this account.\n")).toBe(true);
    expect(parseCursorModelsOutput("No models available for this account.")).toEqual([]);
  });
});
