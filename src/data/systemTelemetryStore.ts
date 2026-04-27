import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type SystemTelemetrySample = {
  sampledAt: string;
  cpuPercent: number | null;
  memUsedPercent: number;
  memUsedBytes: number;
  batteryPercent: number | null;
  batteryCharging: boolean | null;
  thermalState: string | null;
};

export class SystemTelemetryStore {
  private readonly dbPath: string;
  private db: InstanceType<typeof Database> | null = null;

  constructor(projectRoot: string) {
    this.dbPath = join(resolve(projectRoot), ".winnow", "winnow.db");
  }

  async init(): Promise<void> {
    if (this.db) return;
    mkdirSync(dirname(this.dbPath), { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS system_telemetry (
        sampled_at         TEXT PRIMARY KEY,
        cpu_percent        REAL,
        mem_used_percent   REAL NOT NULL DEFAULT 0,
        mem_used_bytes     INTEGER NOT NULL DEFAULT 0,
        battery_percent    REAL,
        battery_charging   INTEGER,
        thermal_state      TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_system_telemetry_sampled_at ON system_telemetry(sampled_at);
    `);
    // Keep roughly 24h at 15s cadence.
    this.db
      .prepare(
        `DELETE FROM system_telemetry
         WHERE sampled_at NOT IN (
           SELECT sampled_at FROM system_telemetry ORDER BY sampled_at DESC LIMIT 5760
         )`,
      )
      .run();
  }

  add(sample: SystemTelemetrySample): void {
    if (!this.db) return;
    this.db
      .prepare(
        `INSERT INTO system_telemetry (
          sampled_at, cpu_percent, mem_used_percent, mem_used_bytes,
          battery_percent, battery_charging, thermal_state
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(sampled_at) DO UPDATE SET
          cpu_percent = excluded.cpu_percent,
          mem_used_percent = excluded.mem_used_percent,
          mem_used_bytes = excluded.mem_used_bytes,
          battery_percent = excluded.battery_percent,
          battery_charging = excluded.battery_charging,
          thermal_state = excluded.thermal_state`,
      )
      .run(
        sample.sampledAt,
        sample.cpuPercent,
        sample.memUsedPercent,
        sample.memUsedBytes,
        sample.batteryPercent,
        sample.batteryCharging == null ? null : sample.batteryCharging ? 1 : 0,
        sample.thermalState,
      );
    this.db
      .prepare(
        `DELETE FROM system_telemetry
         WHERE sampled_at NOT IN (
           SELECT sampled_at FROM system_telemetry ORDER BY sampled_at DESC LIMIT 5760
         )`,
      )
      .run();
  }

  list(range: "1h" | "6h" | "24h" | "all"): SystemTelemetrySample[] {
    if (!this.db) return [];
    const where =
      range === "all"
        ? ""
        : range === "1h"
          ? "WHERE sampled_at >= ?"
          : range === "6h"
            ? "WHERE sampled_at >= ?"
            : "WHERE sampled_at >= ?";
    const fromMs =
      range === "all" ? null : Date.now() - (range === "1h" ? 60 * 60 * 1000 : range === "6h" ? 6 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000);
    const rows = this.db
      .prepare(
        `SELECT sampled_at AS sampledAt, cpu_percent AS cpuPercent, mem_used_percent AS memUsedPercent, mem_used_bytes AS memUsedBytes,
                battery_percent AS batteryPercent, battery_charging AS batteryCharging, thermal_state AS thermalState
         FROM system_telemetry ${where} ORDER BY sampled_at ASC`,
      )
      .all(...(fromMs == null ? [] : [new Date(fromMs).toISOString()])) as Array<
      SystemTelemetrySample & { batteryCharging: number | null }
    >;
    return rows.map((r) => ({
      ...r,
      batteryCharging: r.batteryCharging == null ? null : Boolean(r.batteryCharging),
    }));
  }
}
