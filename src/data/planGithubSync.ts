import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import type { PlanStore, PlanTaskMapping, PlanTaskNode } from "../data/planStore.js";
import { parseTasksFromMarkdown } from "../data/planStore.js";

function buildIssueBody(
  planId: string,
  planTitle: string,
  task: PlanTaskNode,
  allTasks: PlanTaskNode[],
  markdown: string,
): string {
  const lines = String(markdown || "").replace(/\r/g, "").split("\n");
  // Collect this task's line plus any nested child task lines (deeper indent
  // until we hit a sibling/parent at <= task.indentLevels) and any
  // intervening non-task lines (notes, blockquotes, etc.) that belong to it.
  const startIdx = task.lineIndex;
  let endIdx = lines.length;
  for (const t of allTasks) {
    if (t.lineIndex <= startIdx) continue;
    if (t.indentLevels <= task.indentLevels) {
      endIdx = t.lineIndex;
      break;
    }
  }
  const subtree = lines.slice(startIdx, endIdx).join("\n").replace(/\n+$/, "");
  const sectionLine = task.section ? `**Section:** ${task.section}` : "**Section:** _(root)_";
  const statusLine = `**Status at sync:** ${task.done ? "done (will be closed)" : "open"}`;
  const detailsBlock = subtree.trim().length > 0
    ? `### Details\n\n${subtree}\n`
    : "";
  return [
    `Synced from Winnow plan **${planTitle}** (\`${planId}\`).`,
    "",
    sectionLine,
    statusLine,
    `**Task key:** \`${task.key}\``,
    "",
    detailsBlock,
  ].filter((p) => p !== null && p !== undefined).join("\n").replace(/\n{3,}/g, "\n\n");
}

function runCommand(
  command: string,
  args: string[],
  options: { input?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      resolve({ code: -1, stdout, stderr: stderr + String(err) });
    });
    child.on("close", (code) => {
      resolve({ code: typeof code === "number" ? code : -1, stdout, stderr });
    });
    if (options.input !== undefined) {
      child.stdin.write(options.input);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

async function ghAvailable(): Promise<boolean> {
  const r = await runCommand("gh", ["--version"]);
  return r.code === 0;
}

export type GithubSyncResult = {
  ok: boolean;
  error?: string;
  results: Array<{
    taskKey: string;
    label: string;
    action: "skipped" | "would-create" | "created" | "would-update" | "updated" | "error";
    issueRef?: string;
    issueUrl?: string;
    issueState?: string;
    error?: string;
  }>;
};

export async function syncPlanTasksToGithub(
  planStore: PlanStore,
  planId: string,
  input: { taskKeys: string[]; repo?: string; dryRun?: boolean },
): Promise<GithubSyncResult> {
  const tasks = planStore.listTasks(planId);
  if (tasks.length === 0) {
    return { ok: false, error: "plan has no tasks", results: [] };
  }
  const selected = new Set((input.taskKeys || []).map(String));
  const targets: PlanTaskNode[] = selected.size > 0
    ? tasks.filter((t) => selected.has(t.key))
    : tasks;
  if (targets.length === 0) {
    return { ok: false, error: "no matching tasks for selection", results: [] };
  }
  const dryRun = Boolean(input.dryRun);
  const repoFlag: string[] = input.repo ? ["-R", input.repo] : [];
  const results: GithubSyncResult["results"] = [];

  const plan = planStore.get(planId);
  const planTitle = plan?.title || planId;
  let planMarkdown = "";
  try {
    if (plan?.mdPath) planMarkdown = readFileSync(plan.mdPath, "utf8");
  } catch {
    planMarkdown = "";
  }

  if (!dryRun) {
    if (!(await ghAvailable())) {
      return { ok: false, error: "GitHub CLI 'gh' not installed or not on PATH", results: [] };
    }
  }

  for (const task of targets) {
    const existing = task.mapping;
    if (existing && existing.issueRef) {
      const desiredState = task.done ? "closed" : "open";
      if (existing.issueState === desiredState) {
        results.push({
          taskKey: task.key,
          label: task.label,
          action: "skipped",
          issueRef: existing.issueRef,
          issueUrl: existing.issueUrl ?? undefined,
          issueState: existing.issueState ?? undefined,
        });
        continue;
      }
      if (dryRun) {
        results.push({
          taskKey: task.key,
          label: task.label,
          action: "would-update",
          issueRef: existing.issueRef,
          issueUrl: existing.issueUrl ?? undefined,
          issueState: desiredState,
        });
        continue;
      }
      const num = existing.issueRef.split("#").pop() || "";
      const sub = task.done ? "close" : "reopen";
      const r = await runCommand("gh", ["issue", sub, num, ...repoFlag]);
      if (r.code !== 0) {
        results.push({ taskKey: task.key, label: task.label, action: "error", error: r.stderr || r.stdout });
        continue;
      }
      const updated = planStore.setTaskMapping(planId, task.key, {
        issueRef: existing.issueRef,
        issueUrl: existing.issueUrl,
        issueState: desiredState,
      });
      results.push({
        taskKey: task.key,
        label: task.label,
        action: "updated",
        issueRef: updated.issueRef ?? undefined,
        issueUrl: updated.issueUrl ?? undefined,
        issueState: updated.issueState ?? undefined,
      });
      continue;
    }

    const title = task.label.length > 0 ? task.label : "Plan task";
    const body = buildIssueBody(planId, planTitle, task, tasks, planMarkdown);
    if (dryRun) {
      results.push({ taskKey: task.key, label: task.label, action: "would-create" });
      continue;
    }
    const r = await runCommand("gh", [
      "issue",
      "create",
      "--title",
      title,
      "--body",
      body,
      ...repoFlag,
    ]);
    if (r.code !== 0) {
      results.push({ taskKey: task.key, label: task.label, action: "error", error: r.stderr || r.stdout });
      continue;
    }
    const stdout = String(r.stdout || "").trim();
    const urlMatch = stdout.match(/https?:\/\/\S+/);
    const issueUrl = urlMatch ? urlMatch[0] : null;
    const refMatch = issueUrl ? issueUrl.match(/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/) : null;
    const issueRef = refMatch ? `${refMatch[1]}#${refMatch[2]}` : null;

    // If the task was already marked done before issue creation, close the
    // newly-created issue so its GitHub state matches the plan.
    let finalState: "open" | "closed" = "open";
    if (task.done && issueRef) {
      const num = issueRef.split("#").pop() || "";
      const closeRes = await runCommand("gh", [
        "issue",
        "close",
        num,
        ...repoFlag,
        "--reason",
        "completed",
      ]);
      if (closeRes.code === 0) {
        finalState = "closed";
      } else {
        // Creation succeeded but close failed; record what we know and
        // surface the close error so it can be retried.
        const mapping: PlanTaskMapping = planStore.setTaskMapping(planId, task.key, {
          issueRef,
          issueUrl,
          issueState: "open",
        });
        results.push({
          taskKey: task.key,
          label: task.label,
          action: "error",
          issueRef: mapping.issueRef ?? undefined,
          issueUrl: mapping.issueUrl ?? undefined,
          issueState: mapping.issueState ?? undefined,
          error: `created but failed to close: ${closeRes.stderr || closeRes.stdout}`,
        });
        continue;
      }
    }

    const mapping: PlanTaskMapping = planStore.setTaskMapping(planId, task.key, {
      issueRef,
      issueUrl,
      issueState: finalState,
    });
    results.push({
      taskKey: task.key,
      label: task.label,
      action: "created",
      issueRef: mapping.issueRef ?? undefined,
      issueUrl: mapping.issueUrl ?? undefined,
      issueState: mapping.issueState ?? undefined,
    });
  }
  return { ok: true, results };
}

export type ReconcileConflict = {
  taskKey?: string;
  kind: "missing-mapping-line" | "stale-state" | "task-removed" | "duplicate-key";
  detail: string;
};

export type ReconcileReport = {
  ok: boolean;
  planId: string;
  conflicts: ReconcileConflict[];
  fixed: ReconcileConflict[];
};

export function reconcilePlan(
  planStore: PlanStore,
  planId: string,
  options: { fix?: boolean } = {},
): ReconcileReport {
  const plan = planStore.get(planId);
  if (!plan) {
    return { ok: false, planId, conflicts: [], fixed: [] };
  }
  const mappings = planStore.listTaskMappings(planId);
  const tasks = planStore.listTasks(planId);
  const taskKeys = new Set(tasks.map((t) => t.key));
  const conflicts: ReconcileConflict[] = [];
  const fixed: ReconcileConflict[] = [];

  // 1) Mappings whose task no longer exists in markdown.
  for (const m of mappings) {
    if (!taskKeys.has(m.taskKey)) {
      const c: ReconcileConflict = {
        taskKey: m.taskKey,
        kind: "task-removed",
        detail: `Mapping references task '${m.taskKey}' which is no longer present in markdown.`,
      };
      conflicts.push(c);
      if (options.fix) {
        planStore.setTaskMapping(planId, m.taskKey, {
          issueRef: null,
          issueUrl: null,
          issueState: null,
        });
        fixed.push(c);
      }
    }
  }

  // 2) Tasks whose mapping state diverges from done/open status.
  for (const t of tasks) {
    if (!t.mapping || !t.mapping.issueRef) continue;
    const desired = t.done ? "closed" : "open";
    if (t.mapping.issueState && t.mapping.issueState !== desired) {
      conflicts.push({
        taskKey: t.key,
        kind: "stale-state",
        detail: `Task is ${t.done ? "done" : "open"} but linked issue ${t.mapping.issueRef} is recorded as ${t.mapping.issueState}.`,
      });
    }
  }

  // 3) Inline GitHub comment in markdown but no matching mapping row.
  try {
    const md = readFileSync(plan.mdPath, "utf8");
    const lines = md.replace(/\r/g, "").split("\n");
    const inlineParsed = parseTasksFromMarkdown(md);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || "";
      const inline = line.match(/<!--\s*gh:([^\s>]+)(?:\s+state=(\w+))?(?:\s+url=(\S+?))?\s*-->/);
      if (!inline) continue;
      const owning = inlineParsed.find((t) => t.lineIndex === i);
      if (!owning) continue;
      const mapping = mappings.find((m) => m.taskKey === owning.key);
      if (!mapping) {
        const c: ReconcileConflict = {
          taskKey: owning.key,
          kind: "missing-mapping-line",
          detail: `Markdown line ${i + 1} has inline gh:${inline[1]} but no metadata mapping.`,
        };
        conflicts.push(c);
        if (options.fix) {
          planStore.setTaskMapping(planId, owning.key, {
            issueRef: inline[1] || null,
            issueState: inline[2] || null,
            issueUrl: inline[3] || null,
          });
          fixed.push(c);
        }
      }
    }
  } catch {
    // ignore read errors
  }

  // 4) Duplicate task keys (defensive).
  const counts = new Map<string, number>();
  for (const t of tasks) counts.set(t.key, (counts.get(t.key) || 0) + 1);
  for (const [k, n] of counts) {
    if (n > 1) {
      conflicts.push({
        taskKey: k,
        kind: "duplicate-key",
        detail: `Task key '${k}' appears ${n} times; reconcile may merge unexpectedly.`,
      });
    }
  }

  return { ok: true, planId, conflicts, fixed };
}
