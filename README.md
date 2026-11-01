# heroes-assets

Heroes of the Storm game data and UI assets, extracted with
[Heroes Data Parser](https://github.com/HeroesToolChest/HeroesDataParser) (HDP) for the live game
and the PTR. GitHub Actions rebuild them whenever a game server updates, then release and deploy
them to GitHub Pages: <https://myrddraall.github.io/heroes-assets/>.

## What's in it

Each channel has its own folder, `live/` and `ptr/`, laid out the same way:

| Path                                    | What                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| `version.json`                          | The game version extracted, the tool revision, the release version and the HDP version     |
| `raw/data/`, `raw/gamestrings/`         | HDP's output as it came (`--localized-text Extract`), with its map-specific patches        |
| `heroes/index.json`                     | Every hero's summary: ids, franchise, rarity, ratings, release date…                       |
| `heroes/<heroId>.json`                  | One hero's full data, plus `sheet` and `icons`: where each ability and talent icon sits    |
| `heroes/sheets/<heroId>.png`            | That hero's ability and talent icons (and its hero units'), one picture                    |
| `portraits/<kind>.png`, `index.json`    | Every hero's portrait of one kind (`minimap`, `heroSelect`, `draftScreen`…) as one sheet   |
| `emoticons/index.json`                  | Every emote and emote pack; each emote's sheet and place, and its animation if it has one  |
| `emoticons/sheets/<hero>.png`           | A hero's emotes (still; an animated one's first frame), `universal.png` for the rest       |
| `emoticons/animated/*.apng`             | The animated emotes                                                                        |
| `maps/index.json`, `maps/images/`       | Maps by normalized id (`cursed_hollow`): replay previews, loading screens, objective icons |
| `strings/<locale>/heroes.json`          | Heroes' names, titles, roles, descriptions                                                 |
| `strings/<locale>/heroes/<heroId>.json` | A hero's ability, talent and unit texts, by the `linkId`s in `heroes/<heroId>.json`        |
| `strings/<locale>/emoticons.json`       | Emote descriptions and localized aliases, emote pack names                                 |
| `strings/<locale>/maps.json`            | Map names and objective texts                                                              |

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
| `update-live.yml`        | Daily, or by hand                            | Checks the live server's version; rebuilds `live/` when it changed   |
| `update-ptr.yml`         | Daily, or by hand                            | The same for the PTR and `ptr/`                                      |
| `update.yml`             | Called by both                               | Extract, build, commit, merge the release PR, wait for it, deploy    |
| `create-release-pr.yml`  | Each push to `main`, or the update           | git-flow: opens or updates the release PR (`main` → `release/main`)  |
| `build-pack-publish.yml` | The release PR merged, or the update         | git-flow: builds the site, publishes the GitHub release with its zip |
| `deploy-production.yml`  | After each update, `gitflow deploy`, by hand | Deploys one release's site to the `gh-pages` branch                  |

Run an update by hand with **rebuild** ticked to rebuild the same game version after a tool fix.
Nobody merges release PRs by hand: the update merges them. Pushes and merges made with a
workflow's own token start no other workflows, so the update dispatches Create Release PR and
Build, Pack & Publish itself and waits for each; no personal token is needed.

**Rolling back:** deploy an older release. Run `pnpm gitflow deploy` and pick the version, or run
**Deploy — Production** from the Actions tab with its tag (`@myrddraall/heroes-assets/v2.57.9834800`).

### Setup

- GitHub Pages serves the `gh-pages` branch.
- Settings → Actions → General: workflows have read and write permissions and may create pull
  requests (git-flow opens the release PRs).

## Tools

| Command                                                    | What                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| `pnpm run check.update <live\|ptr> [--rebuild]`            | Whether a channel needs a new build, and its version  |
| `pnpm run build.channel <live\|ptr> <hdp out>`             | Builds a channel's folder from HDP's output           |
| `pnpm run set.version <live\|ptr> <game> <revision> <hdp>` | Writes `version.json` and `.publish/versions.yml`     |
| `pnpm run build.site`                                      | Builds the Pages site (`site/dist`) from both folders |

HDP's command, as the update runs it:

```bash
HeroesDataParser online [--download-ptr] -e hero:i -e unit -e emoticon:i -e emoticonpack -e map:i \
  -l all --localized-text Extract -o hdp-out \
  --gs-replace-constant-vars --gs-replace-style-vars --gs-preserve-constant-vars --gs-preserve-style-vars
```

## Credits

Game data and pictures © Blizzard Entertainment. Extracted with HeroesToolChest's
[Heroes Data Parser](https://github.com/HeroesToolChest/HeroesDataParser).
