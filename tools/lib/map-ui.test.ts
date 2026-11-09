import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { mapTextures, readMods } from './map-ui.ts';

test("a map's interface textures are its map mods', not the base data's beside them", async () => {
  const root = await mkdtemp(join(tmpdir(), 'map-ui-'));
  const write = async (path: string, text: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  };
  try {
    await write(
      'mods/heroesmapmods/battlegroundmapmods/cursedhollow.stormmod/base.stormdata/gamedata/actordata.xml',
      '<Image value="Assets\\Textures\\Storm_UI_InGame_TargetInfoPanel_Unit_CursedHollow_Merc_Siege.dds"/>',
    );
    // the base data, extracted for map units: every map's textures, none a map's own
    await write(
      'mods/heroesdata.stormmod/base.stormdata/gamedata/actordata.xml',
      '<Image value="Assets\\Textures\\storm_ui_icon_somehero.dds"/>',
    );
    const mods = await readMods(root);
    assert.deepEqual([...mods.keys()], ['cursedhollow']);
    assert.deepEqual(
      mapTextures(new Map([['Cursed Hollow', ['cursedhollow', 'heroesdata']]]), mods, [
        'Cursed Hollow',
      ]),
      { 'Cursed Hollow': ['storm_ui_ingame_targetinfopanel_unit_cursedhollow_merc_siege'] },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
