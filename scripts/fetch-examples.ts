#!/usr/bin/env bun

import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const LOCAL_EXAMPLES_ROOT = join(REPO_ROOT, "examples");
const DEFAULT_LIBRARY_URL = "https://umple.org/umpleonline/umplibrary/";
const REQUEST_TIMEOUT_MS = 15_000;
const DOWNLOAD_CONCURRENCY = 8;
const MAX_LISTING_DEPTH = 4;

// nginx truncates the text of long links but never the href, so only hrefs are read.
const HREF_RE = /<a href="([^"]*)"/gi;
// Library entries are a single plain file or directory name, which rules out
// parent links, absolute paths, traversal and links to other hosts.
const LIBRARY_ENTRY_RE = /^[A-Za-z0-9_.\-]+\/?$/;
// Rendered diagrams live beside the examples and hold no .ump sources.
const SKIPPED_DIRECTORIES = ["imagecache/", "imagecachesm/", "imagecachestructure/"];

// Only the parts of examples/example_manifest.json this script relies on.
type ExampleManifest = {
  sets: { examples: { filename: string }[] }[];
};

type Args = {
  libraryURL: string;
  outDir: string;
  verifyManifest: boolean;
};

function parseArgs(argv: string[]): Args {
  let libraryURL = DEFAULT_LIBRARY_URL;
  let outDir = LOCAL_EXAMPLES_ROOT;
  let verifyManifest = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--library-url") {
      libraryURL = requireValue(arg, argv[++index]);
      continue;
    }
    if (arg === "--out-dir") {
      outDir = resolve(requireValue(arg, argv[++index]));
      continue;
    }
    if (arg === "--verify-manifest") {
      verifyManifest = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return {
    libraryURL: libraryURL.endsWith("/") ? libraryURL : `${libraryURL}/`,
    outDir,
    verifyManifest,
  };
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function isLibraryEntry(href: string): boolean {
  return href !== "../" && LIBRARY_ENTRY_RE.test(href);
}

async function fetchText(url: string): Promise<string> {
  // The library never redirects for the paths it lists, so a redirect means the
  // request was wrong or the resource moved to another host.
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`GET ${url} failed with status ${response.status}`);
  }
  return response.text();
}

export async function listExamplePaths(
  libraryURL: string,
  directory = "",
  depth = 0,
): Promise<string[]> {
  if (depth > MAX_LISTING_DEPTH) {
    throw new Error(`library listing nested deeper than ${MAX_LISTING_DEPTH} levels`);
  }

  const listing = await fetchText(libraryURL + directory);
  const paths: string[] = [];
  const directories: string[] = [];

  for (const match of listing.matchAll(HREF_RE)) {
    const href = match[1] ?? "";
    if (!isLibraryEntry(href)) continue;
    if (href.endsWith("/")) {
      if (!SKIPPED_DIRECTORIES.includes(href)) {
        directories.push(directory + href);
      }
      continue;
    }
    if (href.endsWith(".ump")) {
      paths.push(directory + href);
    }
  }

  for (const nested of directories) {
    paths.push(...(await listExamplePaths(libraryURL, nested, depth + 1)));
  }

  return paths;
}

// Examples are written through a temporary file so an interrupted download
// cannot leave a truncated example behind.
async function writeExampleFile(target: string, content: string) {
  const temp = `${target}.${process.pid}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  try {
    await writeFile(temp, content);
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

export async function downloadExamples(libraryURL: string, outDir: string, paths: string[]) {
  let next = 0;
  let failure: unknown = null;

  // The first failure stops the queue, but every worker is awaited before it is
  // reported, so no download is still writing when this returns.
  const workers = Array.from(
    { length: Math.min(DOWNLOAD_CONCURRENCY, paths.length) },
    async () => {
      while (next < paths.length && failure === null) {
        const path = paths[next++]!;
        try {
          await writeExampleFile(join(outDir, path), await fetchText(libraryURL + path));
        } catch (error) {
          failure ??= error;
        }
      }
    },
  );

  await Promise.all(workers);

  if (failure !== null) {
    throw failure;
  }
}

// verifyManifestExamples checks that every example the picker offers was
// downloaded, so an incomplete seed cannot reach an offline image.
export async function verifyManifestExamples(outDir: string): Promise<number> {
  const manifest = JSON.parse(
    await readFile(join(outDir, "example_manifest.json"), "utf8"),
  ) as ExampleManifest;

  // The same source path may appear in more than one curated set.
  const sourcePaths = new Set(
    manifest.sets.flatMap((exampleSet) =>
      exampleSet.examples.map((example) => example.filename),
    ),
  );

  const missing: string[] = [];
  for (const sourcePath of sourcePaths) {
    const stats = await stat(join(outDir, sourcePath)).catch(() => null);
    if (!stats?.size) {
      missing.push(sourcePath);
    }
  }

  if (missing.length > 0) {
    throw new Error(`missing or empty curated examples: ${missing.sort().join(", ")}`);
  }

  return sourcePaths.size;
}

async function main() {
  const { libraryURL, outDir, verifyManifest } = parseArgs(Bun.argv.slice(2));

  console.log(`Listing .ump examples in ${libraryURL}...`);
  const paths = await listExamplePaths(libraryURL);
  if (paths.length === 0) {
    throw new Error(`no .ump examples found in ${libraryURL}`);
  }

  await downloadExamples(libraryURL, outDir, paths);

  const location = outDir.startsWith(REPO_ROOT) ? relative(REPO_ROOT, outDir) : outDir;
  console.log(`Downloaded ${paths.length} .ump examples into ${location}`);

  if (verifyManifest) {
    console.log(`Verified ${await verifyManifestExamples(outDir)} curated examples`);
  }
}

if (import.meta.main) {
  await main();
}
