// Whether a channel needs a new build: its server has a game version the folder doesn't hold yet,
// or a rebuild was asked for (a tool fix, same game build: the next revision).
//
//   node tools/check-update.ts <live|ptr> [--rebuild]
//
// Prints `changed`, `game`, `revision` and `version`, and writes them to $GITHUB_OUTPUT in CI.
import { appendFile } from 'node:fs/promises';
import {
  asChannel,
  channelVersion,
  formatGameVersion,
  releaseVersion,
  serverVersion,
} from './lib/channels.ts';

const channel = asChannel(process.argv[2]);
const rebuild = process.argv.includes('--rebuild');

const server = await serverVersion(channel);
const game = formatGameVersion(server);
const current = await channelVersion(channel);
const sameGame = current?.game === game;
const revision = sameGame ? current.revision + 1 : 0;

const outputs = {
  changed: String(!sameGame || rebuild),
  game,
  revision: String(revision),
  version: releaseVersion(channel, server, revision),
};
const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
console.log(`${channel}: server ${game}, folder ${current?.game ?? 'empty'}`);
console.log(lines.join('\n'));
if (process.env['GITHUB_OUTPUT']) {
  await appendFile(process.env['GITHUB_OUTPUT'], `${lines.join('\n')}\n`);
}
