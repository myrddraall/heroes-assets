// Stores an extraction (tools/extract.ts's output, all locales merged) as a channel's newest build
// in sources/ (lib/sources.ts).
//
//   node tools/store-extraction.ts <live|ptr> <game version> <extraction folder>
import { asChannel, parseGameVersion } from './lib/channels.ts';
import { EXTRACTION_KEY } from './lib/extraction.ts';
import { readExtraction, storeLatest } from './lib/sources.ts';

const [, , channelArg, game, folder] = process.argv;
const channel = asChannel(channelArg);
if (!game || !folder) throw new Error('Usage: store-extraction.ts <live|ptr> <game> <folder>');
parseGameVersion(game);

const docs = await readExtraction(folder, game);
await storeLatest(channel, { game, extraction: EXTRACTION_KEY, origin: 'hdp' }, docs);
console.log(`${channel}: stored ${game} (${docs.size} documents)`);
