import Database from "better-sqlite3";
import pty from "node-pty";

const db = new Database(":memory:");
db.prepare("SELECT 1 AS ok").get();
db.close();

if (typeof pty.spawn !== "function") {
  throw new Error("node-pty loaded but spawn is missing");
}
