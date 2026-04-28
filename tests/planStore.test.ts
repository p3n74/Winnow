import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PlanStore } from "../src/data/planStore.js";

describe("PlanStore", () => {
  it("creates plans with UUID ids that stay independent from renamed titles", () => {
    return mkdtemp(join(tmpdir(), "winnow-plans-")).then((dir) => {
      const store = new PlanStore(dir);
      store.init();

      const created = store.create({ title: "Untitled plan" });
      expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(created.id).not.toBe("untitled-plan");

      const renamed = store.save(created.id, { title: "Winnow Planning and Efficiency Module" });
      expect(renamed.id).toBe(created.id);
      expect(renamed.title).toBe("Winnow Planning and Efficiency Module");
    });
  });
});
