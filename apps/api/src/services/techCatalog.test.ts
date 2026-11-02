import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TECH_CATALOG, catalogEntry } from "./techCatalog.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const readJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(repoRoot, rel), "utf8"));

function declaredIn(manifest: string, dependency: string): string | undefined {
  const pkg = readJson(manifest);
  if (dependency === "engines.node") return pkg.engines?.node;
  return pkg.dependencies?.[dependency] ?? pkg.devDependencies?.[dependency];
}

test("catalog versions match the package.json they were copied from", () => {
  for (const entry of TECH_CATALOG) {
    if (entry.declared?.source === "package.json") {
      assert.equal(entry.declared.version, declaredIn(entry.declared.manifest, entry.declared.dependency), `${entry.id}`);
    }
    for (const pkg of entry.packages ?? []) {
      assert.equal(pkg.version, declaredIn(pkg.manifest, pkg.dependency), `${entry.id} → ${pkg.dependency}`);
    }
  }
});

test("catalog ids are unique, billed_with points at a real entry, links are https", () => {
  const ids = TECH_CATALOG.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const entry of TECH_CATALOG) {
    if (entry.billed_with) assert.ok(catalogEntry(entry.billed_with), `${entry.id} billed_with`);
    for (const link of entry.links) assert.match(link.url, /^https:\/\//, `${entry.id} ${link.label}`);
  }
});

test("every plain file path in used_in exists in the repo", () => {
  for (const entry of TECH_CATALOG) {
    for (const ref of entry.used_in) {
      // Only check plain paths: skip globs, annotations like "fly.toml [[mounts]]", and prose.
      if (/[*\s]/.test(ref)) continue;
      assert.ok(fs.existsSync(path.join(repoRoot, ref)), `${entry.id}: ${ref} not found`);
    }
  }
});

test("fly.toml still matches the Fly.io facts", () => {
  const toml = fs.readFileSync(path.join(repoRoot, "fly.toml"), "utf8");
  assert.match(toml, /app = "petropro-api"/);
  assert.match(toml, /primary_region = "sin"/);
  assert.match(toml, /source = "petropro_data"/);
});
