// Retired icons: ability and talent icons the game still ships but its data no longer names (a
// talent reworked away, an ability's old look). Past builds' data still names them, so the main
// locale's extraction takes every `storm_ui_icon_*` texture HDP didn't write as a picture
// (retired-icons/textures/<name>.dds), and the build gives each a file of its own that
// pictures.json lists: an app showing an old match finds them with the newest build's pictures.
//
// Node built-ins only: tools/extract.ts loads this without installing packages.
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

/** Bumped when this changes what the extraction holds. */
export const RETIRED_ICONS_VERSION = 1;

/** Where in an extraction the retired icons' textures are. */
export const RETIRED_ICON_TEXTURES = 'retired-icons/textures';

/** The game's ability and talent icons, for HDP's casc-extract. */
export const ICON_PATTERN = '**/assets/textures/storm_ui_icon_*.dds';

/** Whether a texture's file name (lower case) is an ability or talent icon's. */
const isIcon = (file: string): boolean => /^storm_ui_icon_.+\.dds$/.test(file);

/**
 * The texture names (lower case, without `.dds`) of `textures` (file names) that no picture in
 * `named` (file names as HDP writes them, any extension) is: the icons the data doesn't name.
 */
export function retiredIcons(textures: Iterable<string>, named: Iterable<string>): string[] {
  const pictures = new Set([...named].map((file) => file.toLowerCase().replace(/\.[^.]+$/, '')));
  return [
    ...new Set(
      [...textures]
        .map((file) => basename(file).toLowerCase())
        .filter(isIcon)
        .map((file) => file.slice(0, -'.dds'.length))
        .filter((name) => !pictures.has(name)),
    ),
  ].sort();
}

async function* walk(folder: string): AsyncGenerator<string> {
  for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

/**
 * Copies the icons a casc-extract of `ICON_PATTERN` (in `root`) holds that HDP's pictures (in
 * `images`) don't into `out`, as `<name>.dds`; returns their names.
 */
export async function gatherRetiredIcons(
  root: string,
  images: string,
  out: string,
): Promise<string[]> {
  const found = new Map<string, string>();
  for await (const path of walk(root)) {
    const file = basename(path).toLowerCase();
    if (!found.has(file)) found.set(file, path);
  }
  const named: string[] = [];
  for await (const path of walk(images)) named.push(basename(path));
  const names = retiredIcons(found.keys(), named);
  await mkdir(out, { recursive: true });
  for (const name of names) await copyFile(found.get(`${name}.dds`)!, join(out, `${name}.dds`));
  return names;
}
