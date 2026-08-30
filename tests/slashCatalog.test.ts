import { mkdir, writeFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeAll, describe, expect, it } from "vitest";
import { expandSlashPrompt, listSlashCatalog } from "../src/cursor/slashCatalog.js";

let projectRoot = "";
let homeRoot = "";

async function writeFileAt(path: string, contents: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, contents, "utf8");
}

beforeAll(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "winnow-slash-project-"));
  homeRoot = await mkdtemp(join(tmpdir(), "winnow-slash-home-"));

  await writeFileAt(
    join(homeRoot, ".cursor", "commands", "deploy-staging.md"),
    `---
name: deploy-staging
description: from-user
---

User body for deploy.
`,
  );
  await writeFileAt(
    join(homeRoot, ".cursor", "commands", "user-only.txt"),
    "Plain text command body.\n",
  );
  await writeFileAt(
    join(projectRoot, ".cursor", "commands", "deploy-staging.md"),
    `---
name: deploy-staging
description: from-project
---

Deploy to staging: $ARGUMENTS
`,
  );
  await writeFileAt(
    join(projectRoot, ".cursor", "commands", "broken.md"),
    "---\nthis is not: really: yaml\n",
  );

  await writeFileAt(
    join(homeRoot, ".agents", "skills", "tdd", "SKILL.md"),
    `---
name: tdd
description: Test-driven development loop
icon: beaker
color: green
disable-model-invocation: true
---

Write the failing test first.
`,
  );
  await writeFileAt(
    join(projectRoot, ".cursor", "skills", "nested", "deep", "audit", "SKILL.md"),
    `---
description: Audit the codebase
---

Audit body for the project.
`,
  );
  await writeFileAt(
    join(projectRoot, ".cursor", "skills", "review", "SKILL.md"),
    `---
name: review
description: Project review skill
---

Project review body.
`,
  );
  await writeFileAt(
    join(projectRoot, ".cursor", "skills", "node_modules", "junk", "SKILL.md"),
    `---
name: junk
description: should never be discovered
---
`,
  );
});

describe("listSlashCatalog", () => {
  it("lists modes, winnow presets, builtins, commands, then skills", () => {
    const items = listSlashCatalog(projectRoot, homeRoot);
    expect(items.slice(0, 3).map((item) => item.id)).toEqual(["mode:agent", "mode:ask", "mode:plan"]);
    expect(items.filter((item) => item.kind === "winnow").map((item) => item.id)).toEqual([
      "winnow:implement-tests",
      "winnow:review",
      "winnow:refactor",
    ]);
    const kinds = items.map((item) => item.kind);
    expect(kinds.lastIndexOf("command")).toBeLessThan(kinds.indexOf("skill"));
  });

  it("lets a project command win over the user command with the same name", () => {
    const items = listSlashCatalog(projectRoot, homeRoot);
    const deploy = items.find((item) => item.id === "command:deploy-staging");
    expect(deploy?.description).toBe("from-project");
    expect(deploy?.source).toBe("project");
    expect(items.find((item) => item.name === "user-only")?.source).toBe("user");
  });

  it("discovers nested SKILL.md and reads frontmatter, skipping node_modules", () => {
    const items = listSlashCatalog(projectRoot, homeRoot);
    const audit = items.find((item) => item.id === "skill:audit");
    expect(audit?.description).toBe("Audit the codebase");
    expect(audit?.source).toBe("project");
    const tdd = items.find((item) => item.id === "skill:tdd");
    expect(tdd?.disableModelInvocation).toBe(true);
    expect(tdd?.icon).toBe("beaker");
    expect(tdd?.color).toBe("green");
    expect(items.some((item) => item.name === "junk")).toBe(false);
  });

  it("drops a builtin skill when a discovered skill shadows its name", () => {
    const items = listSlashCatalog(projectRoot, homeRoot);
    const reviews = items.filter((item) => item.name === "review" && item.kind !== "winnow");
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.kind).toBe("skill");
    expect(items.some((item) => item.id === "builtin-skill:create-rule")).toBe(true);
  });

  it("does not throw on malformed files", () => {
    const items = listSlashCatalog(projectRoot, homeRoot);
    expect(items.some((item) => item.name === "broken")).toBe(true);
    expect(items.find((item) => item.name === "broken")?.description).toBe("");
  });

  it("returns an empty-ish catalog for missing roots", () => {
    const items = listSlashCatalog(join(projectRoot, "nope"), join(homeRoot, "nope"));
    expect(items.some((item) => item.kind === "command")).toBe(false);
    expect(items.some((item) => item.kind === "skill")).toBe(false);
  });
});

describe("expandSlashPrompt", () => {
  const base = { projectRoot: "", userHomedir: "" };

  beforeAll(() => {
    base.projectRoot = projectRoot;
    base.userHomedir = homeRoot;
  });

  it("returns the prompt untouched when nothing is invoked", () => {
    expect(expandSlashPrompt({ ...base, userPrompt: "just do it" })).toBe("just do it");
  });

  it("substitutes $ARGUMENTS with the user prompt", () => {
    const out = expandSlashPrompt({
      ...base,
      invocations: [{ kind: "command", id: "command:deploy-staging" }],
      userPrompt: "release 1.2",
    });
    expect(out).toContain("Deploy to staging: release 1.2");
    expect(out).not.toContain("$ARGUMENTS");
    expect(out.endsWith("release 1.2")).toBe(true);
  });

  it("prepends a pinned custom-mode skill body", () => {
    const out = expandSlashPrompt({ ...base, customModeSkill: "tdd", userPrompt: "add a parser" });
    expect(out.startsWith("Write the failing test first.")).toBe(true);
    expect(out).toContain("add a parser");
  });

  it("expands a builtin skill to a single /name line", () => {
    const out = expandSlashPrompt({
      ...base,
      invocations: [{ kind: "builtin-skill", id: "builtin-skill:create-rule" }],
      userPrompt: "for python files",
    });
    expect(out).toBe("/create-rule\n\n---\n\nfor python files");
  });

  it("expands winnow presets to the quickbar text", () => {
    const out = expandSlashPrompt({
      ...base,
      invocations: [{ kind: "winnow", id: "winnow:refactor" }],
      userPrompt: "",
    });
    expect(out).toBe("Refactor this code for readability without changing behavior.");
  });

  it("keeps the body when the user prompt is empty", () => {
    const out = expandSlashPrompt({
      ...base,
      invocations: [{ kind: "skill", id: "skill:audit" }],
      userPrompt: "",
    });
    expect(out).toBe("Audit body for the project.");
  });

  it("keeps invocation order and skips unknown ids", () => {
    const out = expandSlashPrompt({
      ...base,
      invocations: [
        { kind: "skill", id: "skill:audit" },
        { kind: "command", id: "command:does-not-exist" },
        { kind: "winnow", id: "winnow:review" },
      ],
      userPrompt: "go",
    });
    expect(out.split("\n\n---\n\n")).toEqual([
      "Audit body for the project.",
      "Review this code for bugs and edge cases, then propose a minimal patch.",
      "go",
    ]);
  });
});
