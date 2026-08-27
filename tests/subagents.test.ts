import { mkdir, writeFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  extractLiveSubagentEvents,
  listSubagentDefinitionFiles,
  parseSubagentMarkdown,
} from "../src/cursor/subagents.js";

describe("parseSubagentMarkdown", () => {
  it("reads YAML frontmatter fields and defaults name from the filename stem", () => {
    const markdown = `---
name: explorer
description: Deep codebase exploration
model: inherit
readonly: true
---

You explore the tree and report findings.
`;
    const parsed = parseSubagentMarkdown("explorer.md", markdown);
    expect(parsed).toEqual({
      name: "explorer",
      description: "Deep codebase exploration",
      model: "inherit",
      readonly: true,
      fileName: "explorer.md",
    });
  });

  it("defaults name from the filename when frontmatter omits it", () => {
    const markdown = `---
description: Auth specialist
model: inherit
---
`;
    const parsed = parseSubagentMarkdown("auth-review.md", markdown);
    expect(parsed?.name).toBe("auth-review");
    expect(parsed?.description).toBe("Auth specialist");
  });
});

describe("listSubagentDefinitionFiles", () => {
  it("lets project .cursor/agents win over the user dir for the same name", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "winnow-subagents-project-"));
    const homedir = await mkdtemp(join(tmpdir(), "winnow-subagents-home-"));
    await mkdir(join(projectRoot, ".cursor", "agents"), { recursive: true });
    await mkdir(join(homedir, ".cursor", "agents"), { recursive: true });
    await writeFile(
      join(homedir, ".cursor", "agents", "shared.md"),
      `---
name: shared
description: from-user
model: inherit
---
`,
      "utf8",
    );
    await writeFile(
      join(homedir, ".cursor", "agents", "user-only.md"),
      `---
name: user-only
description: only in homedir
---
`,
      "utf8",
    );
    await writeFile(
      join(projectRoot, ".cursor", "agents", "shared.md"),
      `---
name: shared
description: from-project
model: inherit
---
`,
      "utf8",
    );

    const listed = listSubagentDefinitionFiles(projectRoot, homedir);
    const shared = listed.find((agent) => agent.name === "shared");
    const userOnly = listed.find((agent) => agent.name === "user-only");
    expect(shared?.description).toBe("from-project");
    expect(userOnly?.description).toBe("only in homedir");
  });
});

describe("extractLiveSubagentEvents", () => {
  it("maps a Task tool_call fixture to a live row", () => {
    const row = extractLiveSubagentEvents({
      type: "tool_call",
      subtype: "started",
      tool_call: { TaskToolCall: { args: { description: "Explore auth" } } },
    });
    expect(row).not.toBeNull();
    expect(row?.name).toBe("Task");
    expect(row?.status).toBe("started");
    expect(row?.summary).toBe("Explore auth");
  });

  it("returns null for unknown assistant events", () => {
    expect(extractLiveSubagentEvents({ type: "assistant" })).toBeNull();
  });
});
