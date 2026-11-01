// Builds the GitHub Pages site a release deploys (site/dist): both channels' folders as they are
// in the repository, plus index.json naming the version each holds, and index.html listing each
// channel's files (Pages lists no folders, so the page links every file worth opening).
//
//   node tools/build-site.ts
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  channelVersion,
  CHANNELS,
  LOCALES,
  ROOT,
  type Channel,
  type ChannelVersion,
} from './lib/channels.ts';

const dist = join(ROOT, 'site', 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const index: Partial<Record<Channel, ChannelVersion>> = {};
for (const channel of CHANNELS) {
  const version = await channelVersion(channel);
  if (!version) continue;
  index[channel] = version;
  await cp(join(ROOT, channel), join(dist, channel), { recursive: true });
}
await writeFile(join(dist, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
await writeFile(join(dist, '.nojekyll'), '');

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const link = (href: string, text = href.split('/').pop()!): string =>
  `<a href="${escape(href)}">${escape(text)}</a>`;

/** The files directly in a folder of the site, sorted. */
async function files(folder: string): Promise<string[]> {
  try {
    const entries = await readdir(join(dist, folder), { withFileTypes: true });
    return entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

async function channelSection(channel: Channel, version: ChannelVersion): Promise<string> {
  const heroes = (await files(`${channel}/heroes`)).filter((f) => f !== 'index.json');
  const heroRows = heroes.map((file) => {
    const id = file.replace(/\.json$/, '');
    return `<tr><th scope="row">${escape(id)}</th><td>${link(`${channel}/heroes/${file}`, 'data')}</td><td>${link(`${channel}/heroes/sheets/${id}/hero.webp`, 'hero sheet')}</td><td>${link(`${channel}/heroes/sheets/${id}/abilities.webp`, 'abilities')}</td><td>${link(`${channel}/heroes/sheets/${id}/talents.webp`, 'talents')}</td><td>${link(`${channel}/strings/en-US/heroes/${file}`, 'en-US texts')}</td></tr>`;
  });
  const portraits = (await files(`${channel}/portraits`)).filter((f) => f.endsWith('.webp'));
  const maps: Record<
    string,
    { key: string; sheet: string | null; replayPreviewImage?: string; loadingScreenImage?: string }
  > = JSON.parse(await readFile(join(dist, channel, 'maps', 'index.json'), 'utf8'));
  const minimap: { sheet: string | null } = JSON.parse(
    await readFile(join(dist, channel, 'minimap', 'index.json'), 'utf8'),
  );
  const mapRows = Object.values(maps).map(
    (map) =>
      `<tr><th scope="row">${escape(map.key)}</th><td>${map.sheet ? link(`${channel}/maps/${map.sheet}`, 'interface') : ''}</td><td>${map.replayPreviewImage ? link(`${channel}/maps/${map.replayPreviewImage}`, 'preview') : ''}</td><td>${map.loadingScreenImage ? link(`${channel}/maps/${map.loadingScreenImage}`, 'loading screen') : ''}</td></tr>`,
  );
  const emoteSheets = await files(`${channel}/emoticons/sheets`);
  const localeRows = Object.values(LOCALES).map(
    (tag) =>
      `<tr><th scope="row">${tag}</th>${['heroes', 'emoticons', 'maps']
        .map((name) => `<td>${link(`${channel}/strings/${tag}/${name}.json`, name)}</td>`)
        .join('')}</tr>`,
  );
  const raw = [
    ...(await files(`${channel}/raw/data`)).map((f) => `${channel}/raw/data/${f}`),
    ...(await files(`${channel}/raw/gamestrings`)).map((f) => `${channel}/raw/gamestrings/${f}`),
  ];
  const list = (items: string[]): string =>
    `<ul class="inline">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;

  return `
    <section>
      <h2>${channel === 'live' ? 'Live' : 'PTR'}</h2>
      <p>Game ${escape(version.game)} · release ${escape(version.version)} · ${link(`${channel}/version.json`)}</p>

      <h3>Indexes</h3>
      ${list(
        ['heroes', 'portraits', 'emoticons', 'maps', 'minimap'].map((name) =>
          link(`${channel}/${name}/index.json`, `${name}/index.json`),
        ),
      )}

      <h3>Minimap icons</h3>
      ${list(minimap.sheet ? [link(`${channel}/minimap/${minimap.sheet}`)] : ['none'])}

      <h3>Portraits</h3>
      ${list(portraits.map((f) => link(`${channel}/portraits/${f}`)))}

      <details>
        <summary>Maps (${mapRows.length})</summary>
        <table><tbody>${mapRows.join('')}</tbody></table>
      </details>

      <details>
        <summary>Emote sheets by pack (${emoteSheets.length})</summary>
        ${list(emoteSheets.map((f) => link(`${channel}/emoticons/sheets/${f}`)))}
      </details>

      <details>
        <summary>Heroes (${heroes.length})</summary>
        <table><tbody>${heroRows.join('')}</tbody></table>
      </details>

      <details>
        <summary>Texts by locale (${localeRows.length})</summary>
        <table><tbody>${localeRows.join('')}</tbody></table>
      </details>

      <details>
        <summary>Heroes Data Parser's output (${raw.length} files)</summary>
        ${list(raw.map((f) => link(f)))}
      </details>
    </section>`;
}

const sections = await Promise.all(
  Object.entries(index).map(([channel, version]) => channelSection(channel as Channel, version)),
);

await writeFile(
  join(dist, 'index.html'),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>heroes-assets</title>
    <style>
      body { font: 15px/1.5 system-ui, sans-serif; max-width: 60rem; margin: 2rem auto; padding: 0 1rem; }
      h2 { margin-top: 2.5rem; border-bottom: 1px solid color-mix(in srgb, currentColor 25%, transparent); }
      ul.inline { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; }
      details { margin: 1rem 0; }
      summary { cursor: pointer; font-weight: 600; }
      table { border-collapse: collapse; margin-top: 0.5rem; }
      th, td { padding: 0.15rem 1rem 0.15rem 0; text-align: left; }
      th { font-weight: 500; }
    </style>
  </head>
  <body>
    <h1>heroes-assets</h1>
    <p>
      Heroes of the Storm game data and UI assets, extracted with Heroes Data Parser and rebuilt on
      each game update. ${link('index.json')} names the version each channel holds;
      ${link('https://github.com/myrddraall/heroes-assets#whats-in-it', 'the README')} describes
      the files.
    </p>
    ${sections.join('\n') || '<p>No channel built yet.</p>'}
  </body>
</html>
`,
);
console.log(`site/dist: ${Object.keys(index).join(', ') || 'no channels yet'}`);
