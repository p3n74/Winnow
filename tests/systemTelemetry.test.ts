import { describe, expect, it } from "vitest";
import { parseBatteryOutput, parseThermalOutput } from "../src/data/systemTelemetry.js";

describe("systemTelemetry parsers", () => {
  it("parses pmset battery output", () => {
    const sample =
      "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1234567)\t81%; discharging; 3:44 remaining present: true";
    const parsed = parseBatteryOutput(sample);
    expect(parsed.percent).toBe(81);
    expect(parsed.charging).toBe(false);
    expect(parsed.source).toBe("Battery Power");
  });

  it("parses charging state and AC source", () => {
    const sample =
      "Now drawing from 'AC Power'\n -InternalBattery-0 (id=123)\t43%; charging; 1:20 remaining present: true";
    const parsed = parseBatteryOutput(sample);
    expect(parsed.percent).toBe(43);
    expect(parsed.charging).toBe(true);
    expect(parsed.source).toBe("AC Power");
  });

  it("parses thermal severity output", () => {
    expect(parseThermalOutput("CPU Power notify\nThermal level: Serious")).toBe("serious");
    expect(parseThermalOutput("Thermal level: Nominal")).toBe("nominal");
  });
});
