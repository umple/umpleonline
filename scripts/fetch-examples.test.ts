import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  downloadExamples,
  isLibraryEntry,
  listExamplePaths,
  verifyManifestExamples,
} from "./fetch-examples";

const LONG_NAME = "BcmsMultipleCrisis-Multiple-Coordinator-Configuration.ump";

// Shaped like the real nginx autoindex output, including a truncated link text.
function listing(title: string, entries: string[]): string {
  const rows = entries
    .map((entry) => {
      const text = entry.length > 50 ? `${entry.slice(0, 46)}..&gt;` : entry;
      return `<a href="${entry}">${text}</a>                 10-Aug-2026 17:46    1234`;
    })
    .join("\n");
  return `<html>
<head><title>Index of ${title}</title></head>
<body>
<h1>Index of ${title}</h1><hr><pre><a href="../">../</a>
${rows}
</pre><hr></body>
</html>`;
}

const pages: Record<string, string> = {
  "/": listing("/", [
    "extraExamples1/",
    "imagecache/",
    "manualexamples/",
    "2DShapes.ump",
    LONG_NAME,
    "Airline_classDiagram.mermaid",
    "https://evil.example/Evil.ump",
    "/etc/passwd.ump",
    "../escape.ump",
    "Has Space.ump",
  ]),
  "/extraExamples1/": listing("/extraExamples1/", ["ATOM.ecore.ump", "README.md"]),
  "/imagecache/": listing("/imagecache/", ["Airline.svg", "ShouldNotBeFetched.ump"]),
  "/manualexamples/": listing("/manualexamples/", ["BasicStateMachines1.ump"]),
};

const files: Record<string, string> = {
  "/2DShapes.ump": "class Shape {}\n",
  [`/${LONG_NAME}`]: "class Bcms {}\n",
  "/extraExamples1/ATOM.ecore.ump": "class Atom {}\n",
  "/manualexamples/BasicStateMachines1.ump": "class GarageDoor {}\n",
};

let server: ReturnType<typeof Bun.serve> | null = null;
let libraryURL = "";
let outDir = "";
let failing = new Set<string>();

beforeEach(async () => {
  failing = new Set();
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = decodeURIComponent(new URL(request.url).pathname);
      if (failing.has(path)) return new Response("boom", { status: 500 });
      const body = pages[path] ?? files[path];
      if (body === undefined) return new Response("not found", { status: 404 });
      return new Response(body);
    },
  });
  libraryURL = `http://127.0.0.1:${server.port}/`;
  outDir = await mkdtemp(join(tmpdir(), "umple-seed-test-"));
});

afterEach(async () => {
  server?.stop(true);
  await rm(outDir, { recursive: true, force: true });
});

test("rejects parent, absolute, external and unsafe entries", () => {
  for (const href of [
    "../",
    "/etc/passwd.ump",
    "../escape.ump",
    "https://evil.example/Evil.ump",
    "Has Space.ump",
    "nested/path.ump",
    "",
  ]) {
    expect(isLibraryEntry(href)).toBe(false);
  }
  for (const href of ["2DShapes.ump", LONG_NAME, "extraExamples1/"]) {
    expect(isLibraryEntry(href)).toBe(true);
  }
});

test("lists .ump examples from the root and its subdirectories", async () => {
  const paths = await listExamplePaths(libraryURL);

  expect(paths.toSorted()).toEqual([
    "2DShapes.ump",
    LONG_NAME,
    "extraExamples1/ATOM.ecore.ump",
    "manualexamples/BasicStateMachines1.ump",
  ]);
});

test("ignores non-.ump files and the rendered diagram directories", async () => {
  const paths = await listExamplePaths(libraryURL);

  expect(paths).not.toContain("Airline_classDiagram.mermaid");
  expect(paths).not.toContain("extraExamples1/README.md");
  expect(paths.some((path) => path.startsWith("imagecache"))).toBe(false);
});

test("downloads every listed example to its upstream path", async () => {
  const paths = await listExamplePaths(libraryURL);
  await downloadExamples(libraryURL, outDir, paths);

  for (const [path, content] of Object.entries(files)) {
    expect(await readFile(join(outDir, path.slice(1)), "utf8")).toBe(content);
  }
  expect(await readdir(join(outDir, "extraExamples1"))).toEqual(["ATOM.ecore.ump"]);
});

test("a failed download fails the run and leaves no file behind", async () => {
  failing.add("/manualexamples/BasicStateMachines1.ump");
  const paths = await listExamplePaths(libraryURL);

  await expect(downloadExamples(libraryURL, outDir, paths)).rejects.toThrow("status 500");

  await expect(
    readFile(join(outDir, "manualexamples", "BasicStateMachines1.ump"), "utf8"),
  ).rejects.toThrow();
  const leftovers = await readdir(outDir, { recursive: true });
  expect(leftovers.filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
});

// The curated picker lists the same source path in more than one set.
const manifestFixture = {
  sets: [
    {
      id: "example-set-1",
      label: "Class Diagrams",
      categoryId: "class",
      examples: [
        { filename: "2DShapes.ump", label: "2DShapes *" },
        { filename: "extraExamples1/ATOM.ecore.ump", label: "ATOM Web Syndication" },
      ],
    },
    {
      id: "example-set-3",
      label: "State Machines",
      categoryId: "state",
      examples: [{ filename: "2DShapes.ump", label: "2DShapes *" }],
    },
  ],
};

async function writeManifestFixture() {
  await writeFile(
    join(outDir, "example_manifest.json"),
    JSON.stringify(manifestFixture, null, 2),
  );
}

test("accepts a seed holding every curated example, counting shared paths once", async () => {
  await downloadExamples(libraryURL, outDir, [
    "2DShapes.ump",
    "extraExamples1/ATOM.ecore.ump",
  ]);
  await writeManifestFixture();

  expect(await verifyManifestExamples(outDir)).toBe(2);
});

test("detects a curated example missing from the seed", async () => {
  await downloadExamples(libraryURL, outDir, ["extraExamples1/ATOM.ecore.ump"]);
  await writeManifestFixture();

  await expect(verifyManifestExamples(outDir)).rejects.toThrow(
    "missing or empty curated examples: 2DShapes.ump",
  );
});

test("detects a curated example that was seeded empty", async () => {
  await downloadExamples(libraryURL, outDir, [
    "2DShapes.ump",
    "extraExamples1/ATOM.ecore.ump",
  ]);
  await writeFile(join(outDir, "2DShapes.ump"), "");
  await writeManifestFixture();

  await expect(verifyManifestExamples(outDir)).rejects.toThrow(
    "missing or empty curated examples: 2DShapes.ump",
  );
});

test("a missing example is reported instead of written", async () => {
  await expect(downloadExamples(libraryURL, outDir, ["NoSuchExample.ump"])).rejects.toThrow(
    "status 404",
  );
  expect(await readdir(outDir)).toEqual([]);
});

test("a failed listing request is reported", async () => {
  failing.add("/extraExamples1/");

  await expect(listExamplePaths(libraryURL)).rejects.toThrow("status 500");
});

test("refuses to follow a redirect away from the library", async () => {
  server?.stop(true);
  server = Bun.serve({
    port: 0,
    fetch: () => Response.redirect("https://evil.example/Evil.ump", 302),
  });

  await expect(listExamplePaths(`http://127.0.0.1:${server.port}/`)).rejects.toThrow();
});

test("stops instead of recursing forever", async () => {
  server?.stop(true);
  server = Bun.serve({
    port: 0,
    fetch: () => new Response(listing("/deep/", ["deeper/"])),
  });

  await expect(listExamplePaths(`http://127.0.0.1:${server.port}/`)).rejects.toThrow(
    "nested deeper than",
  );
});
