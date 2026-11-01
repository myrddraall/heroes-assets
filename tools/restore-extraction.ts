// Writes a stored build's extraction back out of sources/ (lib/sources.ts), for build-channel.
//
//   node tools/restore-extraction.ts <live|ptr> <game version|latest> <folder>
import { asChannel } from './lib/channels.ts';
import { builds, writeExtraction } from './lib/sources.ts';

const [, , channelArg, wanted, folder] = process.argv;
const channel = asChannel(channelArg);
if (!wanted || !folder)
  throw new Error('Usage: restore-extraction.ts <live|ptr> <game|latest> <folder>');

for await (const { meta, docs } of builds(channel)) {
  if (wanted !== 'latest' && meta.game !== wanted) continue;
  await writeExtraction(docs, meta.game, folder);
  console.log(`${channel}: restored ${meta.game} into ${folder}`);
  process.exit(0);
}
throw new Error(`${channel}: no stored build ${wanted}`);
