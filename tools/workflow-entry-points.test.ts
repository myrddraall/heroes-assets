// The update workflow's plan, extract and game-files jobs run their tools without installing
// packages, and so does its publish job's step for the pictures HDP leaves out
// (.github/workflows/update.yml): everything those tools load must be Node built-ins or this
// repository's own files.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

/** The files a module loads, followed through relative imports, and the packages among them. */
async function packagesLoaded(entry: string): Promise<string[]> {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const visit = async (file: string): Promise<void> => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = await readFile(file, 'utf8');
    // type-only imports vanish when Node strips the types
    for (const [, kind, specifier] of source.matchAll(
      /^(?:import|export)(\s+type)?[^'"]*?from\s+'([^']+)'/gm,
    )) {
      if (kind || specifier!.startsWith('node:')) continue;
      if (specifier!.startsWith('.')) await visit(resolve(dirname(file), specifier!));
      else packages.add(specifier!);
    }
  };
  await visit(entry);
  return [...packages].sort();
}

for (const tool of ['plan.ts', 'extract.ts', 'extract-game-files.ts', 'extract-pictures.ts']) {
  test(`tools/${tool} loads no packages`, async () => {
    assert.deepEqual(await packagesLoaded(join(import.meta.dirname, tool)), []);
  });
}
