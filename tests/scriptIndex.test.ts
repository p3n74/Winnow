import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSampleCommand,
  extractKnobsFromSource,
  extractModuleBlurb,
  looksLikeCliSource,
  rebuildAndWriteScriptIndex,
  resolveScriptFilePath,
  sampleUsageForKnob,
  withSampleUsages,
} from "../src/cli/scriptIndex.js";
import {
  extractYamlRefsFromSource,
  flattenYamlToKnobs,
  isLikelyConfigYamlName,
  parseSimpleYaml,
} from "../src/cli/scriptYaml.js";
import {
  buildProposePrompt,
  buildSpawnArgv,
  mergeKnobs,
  parseProposedCommand,
} from "../src/cli/scriptGuide.js";
import { ScriptStore } from "../src/data/scriptStore.js";

describe("extractKnobsFromSource", () => {
  it("reads argparse help strings into described knobs", () => {
    const source = `
import argparse
parser = argparse.ArgumentParser()
parser.add_argument("--epochs", type=int, default=10, help="number of training epochs")
parser.add_argument("-b", "--batch-size", type=int, default=32, help="mini-batch size")
parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu", help="compute device")
`;
    const knobs = extractKnobsFromSource(source);
    expect(looksLikeCliSource(source)).toBe(true);
    expect(knobs.map((k) => k.flag)).toEqual(["--epochs", "--batch-size", "--device"]);
    expect(knobs[0]?.description).toBe("number of training epochs");
    expect(knobs[0]?.kind).toBe("int");
    expect(knobs[0]?.default).toBe("10");
    expect(knobs[2]?.kind).toBe("enum");
    expect(knobs[2]?.choices).toEqual(["cpu", "cuda"]);
  });
});

describe("extractModuleBlurb", () => {
  it("uses the module docstring", () => {
    expect(extractModuleBlurb('"""Train a tiny model.\\n\\nNot production."""\nprint(1)\n')).toContain(
      "Train a tiny model.",
    );
  });
});

describe("resolveScriptFilePath", () => {
  it("rejects path escape", () => {
    expect(() => resolveScriptFilePath("/tmp/proj", "../etc/passwd")).toThrow(/escape|invalid/);
  });
});

describe("parseProposedCommand", () => {
  it("parses a fenced argv block", () => {
    const parsed = parseProposedCommand(`
Here is the command
\`\`\`json
{"argv":["python3","-u","experiments/train.py","--epochs","12"],"cwd":".","env":{},"notes":"longer training"}
\`\`\`
`);
    expect(parsed.argv).toEqual(["python3", "-u", "experiments/train.py", "--epochs", "12"]);
    expect(parsed.notes).toBe("longer training");
  });

  it("rejects empty argv", () => {
    expect(() => parseProposedCommand('```json\n{"argv":[]}\n```')).toThrow(/empty/);
  });
});

describe("mergeKnobs", () => {
  it("keeps a user-edited description", () => {
    const merged = mergeKnobs(
      [{ id: "epochs", flag: "--epochs", label: "Epochs", description: "my note", kind: "int" }],
      [{ id: "epochs", flag: "--epochs", label: "Training epochs", description: "from argparse", kind: "int", default: "8" }],
      ["epochs"],
    );
    expect(merged[0]?.description).toBe("my note");
    expect(merged[0]?.default).toBe("8");
  });
});

describe("buildSpawnArgv", () => {
  it("forces python -u and sandbox cwd", () => {
    const spawn = buildSpawnArgv("/tmp/proj", {
      argv: ["python", "experiments/train.py", "--epochs", "2"],
      cwd: ".",
      env: { "BAD KEY": "x", PYTHONHASHSEED: "0" },
      notes: "",
    });
    expect(spawn.file).toBe("python3");
    expect(spawn.args[0]).toBe("-u");
    expect(spawn.env.PYTHONUNBUFFERED).toBe("1");
    expect(spawn.env.PYTHONHASHSEED).toBe("0");
    expect(spawn.env["BAD KEY"]).toBeUndefined();
  });

  it("rejects cwd escape", () => {
    expect(() =>
      buildSpawnArgv("/tmp/proj", { argv: ["python3", "x.py"], cwd: "../other", env: {}, notes: "" }),
    ).toThrow(/escape/);
  });
});

describe("rebuildAndWriteScriptIndex", () => {
  it("indexes experiment scripts with knobs and skips tests", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winnow-scripts-"));
    await mkdir(join(dir, "experiments"), { recursive: true });
    await mkdir(join(dir, "tests"), { recursive: true });
    await writeFile(
      join(dir, "experiments", "train.py"),
      `"""Tiny trainer."""\nimport argparse\nparser = argparse.ArgumentParser()\nparser.add_argument("--epochs", type=int, default=3, help="how many epochs")\n`,
      "utf8",
    );
    await writeFile(join(dir, "tests", "test_train.py"), `import argparse\nparser.add_argument("--x", help="no")\n`, "utf8");
    const index = await rebuildAndWriteScriptIndex(dir);
    expect(index.files.map((f) => f.relPath)).toEqual(["experiments/train.py"]);
    expect(index.files[0]?.knobs[0]?.description).toBe("how many epochs");
    expect(index.files[0]?.blurb).toContain("Tiny trainer");
    expect(index.files[0]?.knobs[0]?.sampleUsage).toBe("--epochs 3");
    expect(index.files[0]?.sampleCommand).toContain("--epochs 3");
  });

  it("links sibling YAML configs and lifts keys as yaml knobs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winnow-scripts-yaml-"));
    await mkdir(join(dir, "experiments"), { recursive: true });
    await writeFile(
      join(dir, "experiments", "train.py"),
      `"""Tiny trainer."""\nimport argparse\nparser = argparse.ArgumentParser()\nparser.add_argument("--config", default="config.yaml", help="yaml config")\nparser.add_argument("--epochs", type=int, default=3, help="how many epochs")\n`,
      "utf8",
    );
    await writeFile(
      join(dir, "experiments", "config.yaml"),
      "train:\n  lr: 0.001\n  seed: 7\n",
      "utf8",
    );
    const index = await rebuildAndWriteScriptIndex(dir);
    const entry = index.files[0];
    expect(entry?.linkedConfigs.map((item) => item.relPath)).toEqual(["experiments/config.yaml"]);
    const yamlKnob = entry?.knobs.find((knob) => knob.origin === "yaml" && knob.yamlKey === "train.lr");
    expect(yamlKnob?.default).toBe("0.001");
    expect(yamlKnob?.sampleUsage).toContain("config.yaml");
    expect(yamlKnob?.sampleUsage).toContain("train.lr");
  });
});

describe("ScriptStore", () => {
  it("merges scan knobs without wiping user descriptions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winnow-script-store-"));
    const store = new ScriptStore(dir);
    store.init();
    store.upsertFromScan([
      {
        relPath: "experiments/train.py",
        size: 10,
        shebang: "",
        hasCli: true,
        blurb: "trainer",
        knobs: [{ id: "epochs", flag: "--epochs", label: "Epochs", description: "from source", kind: "int", default: "3" }],
        linkedConfigs: [],
        sampleCommand: "python3 -u experiments/train.py --epochs 3",
      },
    ]);
    store.saveKnobs(
      "experiments/train.py",
      [{ id: "epochs", flag: "--epochs", label: "Epochs", description: "I always bump this", kind: "int", default: "3" }],
      true,
    );
    store.upsertFromScan([
      {
        relPath: "experiments/train.py",
        size: 10,
        shebang: "",
        hasCli: true,
        blurb: "trainer",
        knobs: [{ id: "epochs", flag: "--epochs", label: "Epochs", description: "from source", kind: "int", default: "12" }],
        linkedConfigs: [],
        sampleCommand: "python3 -u experiments/train.py --epochs 12",
      },
    ]);
    const row = store.get("experiments/train.py");
    expect(row?.knobs[0]?.description).toBe("I always bump this");
    expect(row?.knobs[0]?.default).toBe("12");
  });
});

describe("buildProposePrompt", () => {
  it("includes knob legend text", () => {
    const prompt = buildProposePrompt({
      relPath: "experiments/train.py",
      blurb: "trainer",
      knobs: [{ id: "epochs", flag: "--epochs", label: "Training epochs", description: "passes over data", kind: "int", default: "10", sampleUsage: "--epochs 10" }],
      intent: "train a bit longer",
      lastRuns: [],
      sampleCommand: "python3 -u experiments/train.py --epochs 12",
      linkedConfigs: [{ relPath: "configs/train.yaml", knobs: [] }],
    });
    expect(prompt).toContain("Training epochs");
    expect(prompt).toContain("passes over data");
    expect(prompt).toContain("train a bit longer");
    expect(prompt).toContain("Sample usage from scan");
    expect(prompt).toContain("--epochs 12");
    expect(prompt).toContain("configs/train.yaml");
  });
});

describe("sampleUsageForKnob", () => {
  it("builds CLI and YAML sample snippets", () => {
    expect(
      sampleUsageForKnob({
        id: "epochs",
        flag: "--epochs",
        label: "Epochs",
        description: "",
        kind: "int",
        default: "10",
        origin: "cli",
      }),
    ).toBe("--epochs 10");
    expect(
      sampleUsageForKnob({
        id: "yaml-lr",
        flag: "train.lr",
        label: "Train / Lr",
        description: "",
        kind: "float",
        default: "0.1",
        origin: "yaml",
        yamlFile: "experiments/config.yaml",
        yamlKey: "train.lr",
      }),
    ).toBe("experiments/config.yaml → train.lr: 0.1");
  });

  it("builds a sample command from CLI knobs", () => {
    const knobs = withSampleUsages([
      {
        id: "epochs",
        flag: "--epochs",
        label: "Epochs",
        description: "",
        kind: "int",
        default: "3",
        origin: "cli",
      },
    ]);
    expect(buildSampleCommand("experiments/train.py", knobs)).toBe("python3 -u experiments/train.py --epochs 3");
  });
});

describe("script yaml sidecars", () => {
  it("parses nested maps into knobs", () => {
    const parsed = parseSimpleYaml("train:\n  lr: 0.001\n  seed: 7\n");
    const knobs = flattenYamlToKnobs("experiments/config.yaml", parsed);
    expect(knobs.map((knob) => knob.yamlKey)).toEqual(["train.lr", "train.seed"]);
    expect(knobs[0]?.origin).toBe("yaml");
    expect(knobs[0]?.default).toBe("0.001");
    expect(knobs[1]?.kind).toBe("int");
  });

  it("extracts yaml path refs from source", () => {
    expect(extractYamlRefsFromSource(`cfg = "configs/train.yaml"\nopen('local.yml')\n`)).toEqual([
      "configs/train.yaml",
      "local.yml",
    ]);
    expect(isLikelyConfigYamlName("experiments/config.yaml")).toBe(true);
    expect(isLikelyConfigYamlName("notes.yaml")).toBe(false);
  });
});
