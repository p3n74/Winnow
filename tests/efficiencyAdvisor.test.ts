import { describe, expect, it } from "vitest";
import { buildEfficiencyAdvisories } from "../src/data/efficiencyAdvisor.js";
import type { SystemTelemetrySample } from "../src/data/systemTelemetryStore.js";
import type { ManagedProcessRecord } from "../src/data/processManager.js";

function sample(overrides: Partial<SystemTelemetrySample> = {}): SystemTelemetrySample {
  return {
    sampledAt: new Date().toISOString(),
    cpuPercent: 20,
    memUsedPercent: 45,
    memUsedBytes: 1,
    batteryPercent: 80,
    batteryCharging: true,
    thermalState: "nominal",
    ...overrides,
  };
}

function proc(overrides: Partial<ManagedProcessRecord> = {}): ManagedProcessRecord {
  return {
    id: "p1",
    projectRoot: "/tmp/p",
    label: "dev-server",
    command: "npm run dev",
    cwd: "/tmp/p",
    pid: 1234,
    startedAt: new Date().toISOString(),
    status: "running",
    tags: ["dev"],
    logPath: "/tmp/p.log",
    lastOutput: "",
    ...overrides,
  };
}

describe("efficiencyAdvisor", () => {
  it("returns collecting message when no samples", () => {
    const advisories = buildEfficiencyAdvisories([]);
    expect(advisories[0]?.id).toBe("insufficient_data");
  });

  it("emits cpu advisory with process attribution", () => {
    const rows = new Array(8).fill(0).map(() => sample({ cpuPercent: 92, batteryCharging: false }));
    const advisories = buildEfficiencyAdvisories(rows, [proc()]);
    const cpu = advisories.find((a) => a.id === "cpu_sustained_critical");
    expect(cpu).toBeTruthy();
    expect(cpu?.detail).toContain("Likely contributors");
    expect(cpu?.detail).toContain("dev-server");
  });

  it("emits battery warning when discharging and low", () => {
    const advisories = buildEfficiencyAdvisories([sample({ batteryPercent: 15, batteryCharging: false })], []);
    expect(advisories.some((a) => a.id === "battery_warn")).toBe(true);
  });
});
