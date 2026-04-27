import type { SystemTelemetrySample } from "./systemTelemetryStore.js";
import type { ManagedProcessRecord } from "./processManager.js";

export type EfficiencySeverity = "info" | "warn" | "critical";

export type EfficiencyAdvisory = {
  id: string;
  severity: EfficiencySeverity;
  title: string;
  detail: string;
};

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((a, b) => a + b, 0);
  return total / values.length;
}

function attributionHint(processes: ManagedProcessRecord[]): string {
  const running = processes
    .filter((p) => p.status === "running")
    .sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""))
    .slice(0, 3);
  if (running.length === 0) {
    return "No tracked running processes currently.";
  }
  return `Likely contributors: ${running.map((p) => p.label || p.command).join(", ")}.`;
}

export function buildEfficiencyAdvisories(
  samples: SystemTelemetrySample[],
  processes: ManagedProcessRecord[] = [],
): EfficiencyAdvisory[] {
  const rows = [...samples].filter((s) => typeof s.sampledAt === "string");
  if (rows.length === 0) {
    return [
      {
        id: "insufficient_data",
        severity: "info",
        title: "Collecting telemetry",
        detail: "Need a few more samples before efficiency recommendations are available.",
      },
    ];
  }

  const latest = rows[rows.length - 1];
  const window = rows.slice(-8);
  const cpuAvg = avg(window.map((s) => (Number.isFinite(Number(s.cpuPercent)) ? Number(s.cpuPercent) : NaN)).filter(Number.isFinite));
  const memAvg = avg(window.map((s) => Number(s.memUsedPercent || 0)).filter(Number.isFinite));
  const advisories: EfficiencyAdvisory[] = [];

  if (cpuAvg !== null) {
    if (cpuAvg >= 85) {
      advisories.push({
        id: "cpu_sustained_critical",
        severity: "critical",
        title: "Sustained high CPU load",
        detail: `Average CPU usage is ${cpuAvg.toFixed(1)}% over recent samples. Consider pausing heavy watchers or parallel builds. ${attributionHint(processes)}`,
      });
    } else if (cpuAvg >= 65) {
      advisories.push({
        id: "cpu_sustained_warn",
        severity: "warn",
        title: "Elevated CPU usage",
        detail: `Average CPU usage is ${cpuAvg.toFixed(1)}% over recent samples. ${attributionHint(processes)}`,
      });
    }
  }

  if (memAvg !== null) {
    if (memAvg >= 90) {
      advisories.push({
        id: "mem_pressure_critical",
        severity: "critical",
        title: "High memory pressure",
        detail: `Memory use averages ${memAvg.toFixed(1)}%. Close heavy apps or reduce concurrent tasks. ${attributionHint(processes)}`,
      });
    } else if (memAvg >= 80) {
      advisories.push({
        id: "mem_pressure_warn",
        severity: "warn",
        title: "Memory usage is high",
        detail: `Memory use averages ${memAvg.toFixed(1)}%. ${attributionHint(processes)}`,
      });
    }
  }

  const batt = latest.batteryPercent;
  if (Number.isFinite(Number(batt)) && latest.batteryCharging === false) {
    const b = Number(batt);
    if (b <= 10) {
      advisories.push({
        id: "battery_critical",
        severity: "critical",
        title: "Battery critically low",
        detail: `Battery is at ${Math.round(b)}% and discharging.`,
      });
    } else if (b <= 20) {
      advisories.push({
        id: "battery_warn",
        severity: "warn",
        title: "Battery low while coding",
        detail: `Battery is at ${Math.round(b)}% and discharging.`,
      });
    }
  }

  const thermal = String(latest.thermalState || "").toLowerCase();
  if (thermal.includes("critical")) {
    advisories.push({
      id: "thermal_critical",
      severity: "critical",
      title: "Thermal pressure critical",
      detail: "System reports critical thermal pressure. Reduce heavy background work immediately.",
    });
  } else if (thermal.includes("serious")) {
    advisories.push({
      id: "thermal_warn",
      severity: "warn",
      title: "Thermal pressure elevated",
      detail: "System reports serious thermal pressure.",
    });
  }

  if (advisories.length === 0) {
    advisories.push({
      id: "efficiency_ok",
      severity: "info",
      title: "Efficiency looks healthy",
      detail: "No immediate CPU, memory, battery, or thermal concerns detected.",
    });
  }
  return advisories;
}
