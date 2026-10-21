#!/usr/bin/env bun

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const REMOTE_PREFIXES = ["http://", "https://"];
const REPO_ROOT = resolve(import.meta.dir, "..");
const LOCAL_EXAMPLES_ROOT = join(REPO_ROOT, "examples");
const DEFAULT_LEGACY_REPO = "https://github.com/umple/umple.git";
const DEFAULT_LEGACY_REF = "master";

type ExampleManifest = {
  sets: ExampleSet[];
};

type ExampleSet = {
  id: string;
  label: string;
  categoryId: string;
  examples: ExampleEntry[];
};

type ExampleEntry = {
  filename: string;
  label: string;
};

type ExampleSetDef = {
  selectId: string;
  setId: string;
  label: string;
  categoryId: string;
  source: "umple.php" | "generatedExtraExample1OptionsAD.html";
};

const SET_DEFS: ExampleSetDef[] = [
  {
    selectId: "inputExample",
    setId: "example-set-1",
    label: "Class Diagrams",
    categoryId: "class",
    source: "umple.php",
  },
  {
    selectId: "inputExample5",
    setId: "example-set-2",
    label: "Extra Class Diagrams",
    categoryId: "class",
    source: "generatedExtraExample1OptionsAD.html",
  },
  {
    selectId: "inputExample2",
    setId: "example-set-3",
    label: "State Machines",
    categoryId: "state",
    source: "umple.php",
  },
  {
    selectId: "inputExample4",
    setId: "example-set-4",
    label: "Feature Diagrams",
    categoryId: "feature",
    source: "umple.php",
  },
  {
    selectId: "inputExample3",
    setId: "example-set-5",
    label: "Composite Structure",
    categoryId: "structure",
    source: "umple.php",
  },
];

const OPTION_RE = /<option[^>]*value\s*=\s*"([^"]*)"[^>]*>(.*?)<\/option>/gis;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

type Args = {
  legacyRepo: string;
  legacyRef: string;
};

function parseArgs(argv: string[]): Args {
  let legacyRepo = DEFAULT_LEGACY_REPO;
  let legacyRef = DEFAULT_LEGACY_REF;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--legacy-repo") {
      legacyRepo = requireValue(arg, argv[++index]);
      continue;
    }
    if (arg === "--legacy-ref") {
      legacyRef = requireValue(arg, argv[++index]);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return { legacyRepo, legacyRef };
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function runGit(args: string[], cwd?: string) {
  const proc = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (proc.exitCode !== 0) {
    const stderr = Buffer.from(proc.stderr).toString().trim();
    throw new Error(`git ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
  }

  return Buffer.from(proc.stdout).toString();
}

async function fetchLegacySnapshot(legacyRepo: string, legacyRef: string): Promise<string> {
  const tempRoot = await mkdtemp(join(tmpdir(), "umple-sync-"));

  try {
    runGit(
      [
        "clone",
        "--depth",
        "1",
        "--branch",
        legacyRef,
        "--filter=blob:none",
        "--sparse",
        legacyRepo,
        tempRoot,
      ],
    );
    runGit(
      [
        "-C",
        tempRoot,
        "sparse-checkout",
        "set",
        "--no-cone",
        "umpleonline/umple.php",
        "umpleonline/generatedExtraExample1OptionsAD.html",
      ],
    );

    return tempRoot;
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

function cleanLabel(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function normalizeOptions(rawHtml: string): ExampleEntry[] {
  const options: ExampleEntry[] = [];
  for (const match of rawHtml.matchAll(OPTION_RE)) {
    const value = match[1]?.trim() ?? "";
    const label = cleanLabel(match[2] ?? "");

    if (!value) continue;
    if (value === "invalid.ump") continue;
    if (REMOTE_PREFIXES.some((prefix) => value.startsWith(prefix))) continue;
    if (label.includes("Umpr Repository")) continue;

    options.push({ filename: value, label });
  }
  return options;
}

function extractSelectOptions(umplePhp: string, selectId: string): ExampleEntry[] {
  const withoutComments = umplePhp.replaceAll(HTML_COMMENT_RE, "");
  const pattern = new RegExp(`<select id="${selectId}"[^>]*>[\\s\\S]*?<\\/select>`, "i");
  const match = withoutComments.match(pattern);
  if (!match) {
    throw new Error(`could not find select #${selectId} in legacy umple.php`);
  }
  return normalizeOptions(match[0]);
}

async function readLegacySources(legacyRoot: string) {
  const umplePhpPath = join(legacyRoot, "umpleonline", "umple.php");
  const extraOptionsPath = join(
    legacyRoot,
    "umpleonline",
    "generatedExtraExample1OptionsAD.html",
  );

  const [umplePhp, extraOptions] = await Promise.all([
    readFile(umplePhpPath, "utf8"),
    readFile(extraOptionsPath, "utf8"),
  ]);

  return { umplePhp, extraOptions };
}

async function buildManifest(legacyRoot: string): Promise<ExampleManifest> {
  const { umplePhp, extraOptions } = await readLegacySources(legacyRoot);
  const sets: ExampleSet[] = [];

  for (const setDef of SET_DEFS) {
    const examples =
      setDef.source === "umple.php"
        ? extractSelectOptions(umplePhp, setDef.selectId)
        : normalizeOptions(extraOptions);

    if (examples.length === 0) {
      throw new Error(`legacy source for ${setDef.setId} produced no examples`);
    }

    sets.push({
      id: setDef.setId,
      label: setDef.label,
      categoryId: setDef.categoryId,
      examples,
    });
  }

  return { sets };
}

function manifestText(manifest: ExampleManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

async function maybeWriteFile(target: string, content: Uint8Array | string): Promise<boolean> {
  const nextBytes =
    typeof content === "string" ? Buffer.from(content) : Buffer.from(content);

  try {
    const existing = await readFile(target);
    if (Buffer.compare(existing, nextBytes) === 0) {
      return false;
    }
  } catch {
    // Write the file if it does not already exist.
  }

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, nextBytes);
  return true;
}

async function main() {
  const { legacyRepo, legacyRef } = parseArgs(Bun.argv.slice(2));
  const legacyRoot = await fetchLegacySnapshot(legacyRepo, legacyRef);

  try {
    const manifest = await buildManifest(legacyRoot);
    const manifestPath = join(LOCAL_EXAMPLES_ROOT, "example_manifest.json");

    if (await maybeWriteFile(manifestPath, manifestText(manifest))) {
      console.log(`Updated ${relative(REPO_ROOT, manifestPath)}`);
    } else {
      console.log(`Manifest already up to date: ${relative(REPO_ROOT, manifestPath)}`);
    }
  } finally {
    await rm(legacyRoot, { recursive: true, force: true });
  }
}

await main();
