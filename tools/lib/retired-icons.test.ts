import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gatherRetiredIcons, retiredIcons } from './retired-icons.ts';

test('the icons no picture is are retired, by texture name', () => {
  assert.deepEqual(
    retiredIcons(
      [
        'mods/a/assets/textures/storm_ui_icon_tassadar_plasmashield.dds',
        'Storm_UI_Icon_Raynor_Inspire.dds',
        'storm_ui_icon_auriel_angelicsweep_a.dds',
        'storm_ui_icon_auriel_angelicsweep_a.dds', // in two mods
        'storm_ui_homescreenbackground_x.dds', // not an icon
      ],
      ['storm_ui_icon_raynor_inspire.png', 'other.png'],
    ),
    ['storm_ui_icon_auriel_angelicsweep_a', 'storm_ui_icon_tassadar_plasmashield'],
  );
});

test('gathering copies only the retired icons, once each', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'retired-'));
  try {
    const casc = join(
      dir,
      'casc',
      'mods',
      'heroes.stormmod',
      'base.stormassets',
      'assets',
      'textures',
    );
    const images = join(dir, 'images', 'abilitytalents');
    await mkdir(casc, { recursive: true });
    await mkdir(images, { recursive: true });
    await writeFile(join(casc, 'storm_ui_icon_old.dds'), 'old');
    await writeFile(join(casc, 'storm_ui_icon_named.dds'), 'named');
    await writeFile(join(images, 'storm_ui_icon_named.png'), 'png');
    const out = join(dir, 'out');
    assert.deepEqual(await gatherRetiredIcons(join(dir, 'casc'), join(dir, 'images'), out), [
      'storm_ui_icon_old',
    ]);
    assert.deepEqual(await readdir(out), ['storm_ui_icon_old.dds']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
