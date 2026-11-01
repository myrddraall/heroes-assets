// Builds the GitHub Pages site a release deploys (site/dist): both channels' folders as they are
// in the repository, plus index.json naming the version each holds, and a small index.html.
//
//   node tools/build-site.ts
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { channelVersion, CHANNELS, ROOT, type ChannelVersion } from './lib/channels.ts';

const dist = join(ROOT, 'site', 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const index: Partial<Record<string, ChannelVersion>> = {};
for (const channel of CHANNELS) {
  const version = await channelVersion(channel);
  if (!version) continue;
  index[channel] = version;
  await cp(join(ROOT, channel), join(dist, channel), { recursive: true });
}

await writeFile(join(dist, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
await writeFile(join(dist, '.nojekyll'), '');
const rows = Object.entries(index)
  .map(
    ([channel, v]) => `<li><a href="${channel}/">${channel}</a>: ${v!.game} (${v!.version})</li>`,
  )
  .join('\n      ');
await writeFile(
  join(dist, 'index.html'),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>heroes-assets</title>
  </head>
  <body>
    <h1>heroes-assets</h1>
    <p>Heroes of the Storm game data and UI assets. See <a href="index.json">index.json</a>.</p>
    <ul>
      ${rows}
    </ul>
  </body>
</html>
`,
);
console.log(`site/dist: ${Object.keys(index).join(', ') || 'no channels yet'}`);
