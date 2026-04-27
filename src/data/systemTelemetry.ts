import { cpus, freemem, loadavg, platform, totalmem } from "node:os";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

type CpuSnapshot = {
  idle: number;
  total: number;
  atMs: number;
};

let prevCpu: CpuSnapshot | null = null;

function readCpuSnapshot(): CpuSnapshot {
  const times = cpus().map((c) => c.times);
  let idle = 0;
  let total = 0;
  for (const t of times) {
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total, atMs: Date.now() };
}

function computeCpuPercent(): number | null {
  const cur = readCpuSnapshot();
  if (!prevCpu) {
    prevCpu = cur;
    return null;
  }
  const totalDelta = cur.total - prevCpu.total;
  const idleDelta = cur.idle - prevCpu.idle;
  prevCpu = cur;
  if (totalDelta <= 0) {
    return null;
  }
  const busy = Math.max(0, totalDelta - idleDelta);
  const pct = (busy / totalDelta) * 100;
  return Math.max(0, Math.min(100, pct));
}

async function readBattery(): Promise<{
  percent: number | null;
  charging: boolean | null;
  source: string | null;
}> {
  if (platform() !== "darwin") {
    return { percent: null, charging: null, source: null };
  }
  try {
    const { stdout } = await execFile("pmset", ["-g", "batt"], { timeout: 1500 });
    const text = String(stdout || "");
    return parseBatteryOutput(text);
  } catch {
    return { percent: null, charging: null, source: null };
  }
}

async function readThermalState(): Promise<string | null> {
  if (platform() !== "darwin") {
    return null;
  }
  try {
    const { stdout } = await execFile("pmset", ["-g", "therm"], { timeout: 1500 });
    const text = String(stdout || "").trim();
    if (!text) {
      return null;
    }
    return parseThermalOutput(text);
  } catch {
    return null;
  }
}

export function parseBatteryOutput(text: string): {
  percent: number | null;
  charging: boolean | null;
  source: string | null;
} {
  const normalized = String(text || "");
  const pctMatch = normalized.match(/(\d+)%/);
  const percent = pctMatch ? Number(pctMatch[1]) : null;
  const sourceMatch = normalized.match(/Now drawing from ['"]([^'"]+)['"]/i);
  const source = sourceMatch ? sourceMatch[1] : null;
  const charging = /;\s*charging;|AC Power/i.test(normalized)
    ? true
    : /Battery Power/i.test(normalized)
      ? false
      : null;
  return { percent, charging, source };
}

export function parseThermalOutput(text: string): string | null {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return null;
  }
  const lowered = normalized.toLowerCase();
  if (lowered.includes("nominal")) return "nominal";
  if (lowered.includes("fair")) return "fair";
  if (lowered.includes("serious")) return "serious";
  if (lowered.includes("critical")) return "critical";
  return normalized.split("\n")[0]?.trim() || null;
}

export async function collectSystemLive(): Promise<{
  cpuPercent: number | null;
  memUsedBytes: number;
  memUsedPercent: number;
  memFreeBytes: number;
  memTotalBytes: number;
  loadAvg: number[];
  batteryPercent: number | null;
  batteryCharging: boolean | null;
  batterySource: string | null;
  thermalState: string | null;
  sampledAt: string;
}> {
  const memTotal = totalmem();
  const memFree = freemem();
  const memUsed = Math.max(0, memTotal - memFree);
  const [battery, thermal] = await Promise.all([readBattery(), readThermalState()]);
  return {
    cpuPercent: computeCpuPercent(),
    memUsedBytes: memUsed,
    memUsedPercent: memTotal > 0 ? (memUsed / memTotal) * 100 : 0,
    memFreeBytes: memFree,
    memTotalBytes: memTotal,
    loadAvg: loadavg(),
    batteryPercent: battery.percent,
    batteryCharging: battery.charging,
    batterySource: battery.source,
    thermalState: thermal,
    sampledAt: new Date().toISOString(),
  };
}
