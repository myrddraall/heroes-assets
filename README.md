# heroes-assets

Heroes of the Storm game data and UI assets, extracted with
[Heroes Data Parser](https://github.com/HeroesToolChest/HeroesDataParser) (HDP) for the live game
and the PTR. GitHub Actions rebuild them whenever a game server updates, then release and deploy
them to GitHub Pages: <https://myrddraall.github.io/heroes-assets/>.

## What's in it

Each channel has its own folder, `live/` and `ptr/`, laid out the same way:

| Path                                    | What                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| `version.json`                          | The game version extracted, the tool revision, the release version and the HDP version   |
| `raw/data/`, `raw/gamestrings/`         | HDP's output as it came (`--localized-text Extract`), with its map-specific patches      |
| `heroes/index.json`                     | Every hero's summary: ids, franchise, rarity, ratings, release date…                     |
| `heroes/<heroId>.json`                  | One hero's full data, plus `sheets.abilities` and `sheets.talents`: each sheet and icons |
| `heroes/sheets/<heroId>/talents.webp`   | That hero's talent icons                                                                 |
| `heroes/sheets/<heroId>/abilities.webp` | Its ability icons (with sub-abilities' and its hero units')                              |
| `portraits/<kind>.webp`, `index.json`   | Every hero's portrait of one kind (`minimap`, `heroSelect`, `draftScreen`…) as one sheet |
| `emoticons/index.json`                  | Every emote and emote pack; each emote's pack, sheet and place, and its animation        |
| `emoticons/sheets/<packId>.webp`        | One emote pack's emotes (still; an animated one's first frame); `other.webp` for none    |
| `emoticons/animated/*.webp`             | The animated emotes, as animated WebPs                                                   |
| `maps/index.json`                       | Maps by normalized id (`cursed_hollow`): HDP's map data, the map's sheet and its icons   |
| `maps/sheets/<mapId>.webp`              | The map's objective icons and the interface textures its mods name (below)               |
| `maps/images/`                          | Replay previews, loading screens, and map interface pictures too big for a sheet         |
| `minimap/units.webp`, `index.json`      | Every unit's minimap icon (towers, camps, tributes, shrines, summons…), keyed by unit    |
| `strings/<locale>/heroes.json`          | Heroes' names, titles, roles, descriptions                                               |
| `strings/<locale>/heroes/<heroId>.json` | A hero's ability, talent and unit texts, by the `linkId`s in `heroes/<heroId>.json`      |
| `strings/<locale>/emoticons.json`       | Emote descriptions and localized aliases, emote pack names                               |
| `strings/<locale>/maps.json`            | Map names and objective texts                                                            |

**A map's interface textures** come from the game's own data (`tools/lib/map-ui.ts`): the map's
`.s2mv` in the depot cache names the mods it's built on, each mod's `DocumentInfo` the mods it
depends on, and every texture those mods name in their catalogs, trigger scripts and layouts is
the map's (terrain, cliff and model textures aside). Units every map shares, such as towers,
camps and the Cursed Hollow tribute, are in no map's mods; their icons are in `minimap/`.

Locales are BCP 47 tags: `en-US`, `de-DE`, `es-ES`, `es-MX`, `fr-FR`, `it-IT`, `ko-KR`, `pl-PL`,
`pt-BR`, `ru-RU`, `zh-CN`, `zh-TW`. A sheet's places are `[x, y, width, height]` in pixels.
The site's `index.json` names the version each channel holds.

## Versions

A release's version comes from the game's: its major and minor, then the build × 100 plus the tool
revision as the patch. A PTR build is a `-ptr` prerelease.

| Game                             | Release            |
| -------------------------------- | ------------------ |
| Live `2.57.0.98348`              | `2.57.9834800`     |
| Same build, rebuilt (a tool fix) | `2.57.9834801`     |
| PTR `2.57.0.98217`               | `2.57.9821700-ptr` |

The revision goes back to `00` with each new game build. Every release stays available, so any of
them can be deployed again.

## Workflows

| Workflow                 | When                                         | What                                                                 |
| ------------------------ | -------------------------------------------- | -------------------------------------------------------------------- |
| `update-live.yml`        | Daily, or by hand                            | Updates `live/` when the live server's version changed               |
| `update-ptr.yml`         | Daily, or by hand                            | The same for the PTR and `ptr/`                                      |
| `update.yml`             | Called by both                               | Plan, extract, publish (below)                                       |
| `create-release-pr.yml`  | Each push to `main`, or the update           | git-flow: opens or updates the release PR (`main` → `release/main`)  |
| `build-pack-publish.yml` | The release PR merged, or the update         | git-flow: builds the site, publishes the GitHub release with its zip |
| `deploy-production.yml`  | After each update, `gitflow deploy`, by hand | Deploys one release's site to the `gh-pages` branch                  |

An update runs in three jobs, each step skipped when its work is done already:

1. **plan** (`tools/plan.ts`) works out what's left from where things stand: the patch server's
   game version, the version the folder holds, whether that's released, whether it's deployed.
2. **extract** runs HDP once per locale, in parallel. The English run also writes the data files and
   pictures; the others keep only their strings. HDP and its download of game files are kept in
   the Actions cache.
3. **publish** builds the folder from the extraction and commits it to `main` (a rebuild of a game
   build whose extraction is stored on its release takes that one and doesn't extract at all),
   opens git-flow's release PR, merges it, publishes the release, stores the extraction on it (only
   the newest release of each channel keeps one) and deploys it to Pages.

Live and PTR plan and extract at the same time; only publish runs one at a time, since both
channels write `.publish/versions.yml` and share the release PR.

**After a failure**, use **Re-run failed jobs**, or start a new update: either carries on where the
last one stopped. Tick **rebuild** to rebuild the same game version after a tool fix: the next
revision, or the same one while it's unreleased. Nobody merges release PRs by hand.

A workflow's own pushes and merges start no other workflows, but its dispatches do: the update
dispatches Create Release PR and Build, Pack & Publish and waits for each, so no personal token is
needed.

**Rolling back:** deploy an older release. Run `pnpm gitflow deploy` and pick the version, or run
**Deploy — Production** from the Actions tab with its tag (`@myrddraall/heroes-assets/v2.57.9834800`).

### Setup

- GitHub Pages serves the `gh-pages` branch.
- Settings → Actions → General: workflows have read and write permissions and may create pull
  requests (git-flow opens the release PRs).

## Tools

| Command                                              | What                                                  |
| ---------------------------------------------------- | ----------------------------------------------------- |
| `pnpm run plan <live\|ptr> [--rebuild]`              | What an update of a channel still has to do           |
| `pnpm run extract <live\|ptr> <locale> <game> <out>` | Runs HDP for one locale (`tools/lib/extraction.ts`)   |
| `pnpm run build.channel <live\|ptr> <hdp out>`       | Builds a channel's folder from HDP's output           |
| `pnpm run set.version <live\|ptr> <game> <revision>` | Writes `version.json` and `.publish/versions.yml`     |
| `pnpm run build.site`                                | Builds the Pages site (`site/dist`) from both folders |

HDP's command for the English run (the other locales leave out the `:i` picture options);
`tools/lib/extraction.ts` holds it:

```bash
HeroesDataParser online [--download-ptr] -e hero:i -e unit -e emoticon:i -e emoticonpack -e map:i \
  -l enus --localized-text Extract \
  --gs-replace-constant-vars --gs-replace-style-vars --gs-preserve-constant-vars --gs-preserve-style-vars \
  -o hdp-out
```

## Credits

Game data and pictures © Blizzard Entertainment. Extracted with HeroesToolChest's
[Heroes Data Parser](https://github.com/HeroesToolChest/HeroesDataParser).
