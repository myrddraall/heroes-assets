import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  loadOrder,
  readActors,
  readCampTypes,
  readScalingTicks,
  readStrings,
  readVeterancy,
} from './map-units.ts';

// the game's own forms, cut down: enums, a shared camp type set up in place, a helper the map's
// library calls with its label, and a helper of the map's library its own script calls
const ENUMS = `
const int libMapM_ge_JungleCampDefenderTypes_Knights = 2;
const int libMapM_ge_JungleCampDefenderTypes_SiegeCamp1 = 5;
const int libMapM_ge_JungleCampMercTypes_Ogres = 2;
const int libMapM_ge_JungleCampMercTypes_SiegeCamp1 = 5;
`;
const BASE = `
void libMapM_InitVariables () {
    libMapM_gv_genericMercCampInitialSpawnDelay_C = 30.0;
}

bool libMapM_gt_DataJungleCampDefenderDataKnights_Func (bool testConds, bool runActions) {
    int lv_campType;
    // Actions
    if (!runActions) {
        return true;
    }

    lv_campType = (libMapM_ge_JungleCampDefenderTypes_Knights);
    libMapM_gv_dataJungleCampDefenderData[lv_campType].lv_respawnTime = 240.0;
    libMapM_gv_dataJungleCampDefenderData[lv_campType].lv_initialSpawnDelay = libMapM_gv_genericMercCampInitialSpawnDelay_C;
    libMapM_gv_dataJungleCampDefenderData[lv_campType].lv_creepUnitTypes[1] = "MercDefenderMeleeKnight";
    libMapM_gv_dataJungleCampDefenderData[lv_campType].lv_creepUnitTypes[2] = "MercDefenderMeleeKnight";
    libMapM_gv_dataJungleCampDefenderData[lv_campType].lv_creepUnitTypes[3] = "MercDefenderRangedMage";
    libMapM_gv_dataJungleCampDefenderData[lv_campType].lv_campTypeMinimapLabel = StringExternal("Param/Value/lib_MapM_EC6BA293");
    libMapM_gf_DataInitializeScalingDataForDefender(libMapM_ge_JungleCampDefenderTypes_Knights, "OgreDefenderScaling");
    lv_rankToStartScaling = 2;
    auto1_ae = (lv_rankToStartScaling - 1);
    lv_rank = 0;
    for ( ; ( (auto1_ai >= 0 && lv_rank <= auto1_ae) || (auto1_ai < 0 && lv_rank >= auto1_ae) ) ; lv_rank += auto1_ai ) {
        libMapM_gv_dataJungleCampDefenderData[lv_campType].lv_campLevel[lv_rank] = 11;
    }
    lv_rank = lv_rankToStartScaling;
    libMapM_gv_dataJungleCampDefenderData[lv_campType].lv_campLevel[lv_rank] = 12;
    lv_rank += 1;
    libMapM_gv_dataJungleCampDefenderData[lv_campType].lv_campLevel[lv_rank] = 13;
    return true;
}

bool libMapM_gt_DataJungleCampMercDataOgres_Func (bool testConds, bool runActions) {
    int lv_campType;
    lv_campType = (libMapM_ge_JungleCampMercTypes_Ogres);
    libMapM_gv_dataJungleCampMercData[lv_campType].lv_spawnedMinionUnitTypes[1] = "MercLanerMeleeKnight";
    libMapM_gv_dataJungleCampMercData[lv_campType].lv_spawnedMinionUnitTypes[2] = "MercLanerMeleeKnight";
    libMapM_gf_DataInitializeScalingDataForMerc(libMapM_ge_JungleCampMercTypes_Ogres, "OgreMercScaling");
    return true;
}

void libMapM_gf_InitializeSapperMercType (int lp_campType, text lp_mercName, fixed lp_initialSpawnDelay, fixed lp_respawnDelay) {
    int lv_campTypeInt;
    lv_campTypeInt = (lp_campType);
    libMapM_gv_dataJungleCampDefenderData[lv_campTypeInt].lv_campTypeMinimapLabel = lp_mercName;
    libMapM_gv_dataJungleCampDefenderData[lv_campTypeInt].lv_respawnTime = lp_respawnDelay;
    libMapM_gv_dataJungleCampDefenderData[lv_campTypeInt].lv_creepUnitTypes[1] = "MercGoblinSapperDefender";
    libMapM_gv_dataJungleCampMercData[lv_campTypeInt].lv_spawnedMinionUnitTypes[1] = "MercGoblinSapperLaner";
    libMapM_gv_dataJungleCampDefenderData[lv_campTypeInt].lv_numberOfRanks = MinI((CatalogFieldValueCount(c_gameCatalogBehavior, "MercGoblinSapperDefenderScaling", "VeterancyLevelArray", c_playerAny) - 1), libCore_gv_dataScalingMaxScalingTicks);
}

void libMapM_gf_InitializeHellbatMercType (int lp_campType, text lp_mercName) {
    int lv_campTypeInt;
    lv_campTypeInt = (lp_campType);
    libMapM_gv_dataJungleCampDefenderData[lv_campTypeInt].lv_creepUnitTypes[1] = "TerranHellbatDefender";
}
`;
const MAP = `
void libMTOD_gf_InitCamps () {
    int lv_campType;
    lv_campType = (libMapM_ge_JungleCampDefenderTypes_Knights);

    // Implementation
    libMapM_gf_InitializeSapperMercType(libMapM_ge_JungleCampMercTypes_SiegeCamp1, StringExternal("Param/Value/lib_MTOD_1EDBBE28"), 30.0, 150.0);
}

void libWCAV_gf_InitializeGnollMercType (int lp_campType) {
    int lv_campTypeInt;
    lv_campTypeInt = (lp_campType);
    libMapM_gv_dataJungleCampDefenderData[lv_campTypeInt].lv_campTypeMinimapLabel = StringExternal("Param/Value/lib_7EB401DE_595DF576");
    libMapM_gv_dataJungleCampDefenderData[lv_campTypeInt].lv_creepUnitTypes[1] = "TerranHellbatDefender";
    libMapM_gv_dataJungleCampDefenderData[lv_campTypeInt].lv_creepUnitTypes[2] = "TerranHellbatDefender";
}
`;

test("a camp type's defender and merc data pair by the number both are indexed by", () => {
  const [knights] = readCampTypes([ENUMS, BASE]);
  assert.deepEqual(knights, {
    id: 'Knights',
    category: 'bruiser',
    label: 'Param/Value/lib_MapM_EC6BA293',
    defenders: [
      { unit: 'MercDefenderMeleeKnight', count: 2 },
      { unit: 'MercDefenderRangedMage', count: 1 },
    ],
    mercs: [{ unit: 'MercLanerMeleeKnight', count: 2 }],
    respawnSeconds: 240,
    firstSpawnSeconds: 30,
    elite: false,
    soloable: false,
    captureXp: null,
    defenderScaling: 'OgreDefenderScaling',
    mercScaling: 'OgreMercScaling',
    // ranks before scaling starts (0, 1) at one level, then up from it
    levels: [11, 11, 12, 13],
  });
});

test("a helper's camp type comes from each call, with its arguments", () => {
  const camps = readCampTypes([ENUMS, BASE, MAP], 2);
  const sapper = camps.find((c) => c.id === 'SiegeCamp1');
  assert.equal(sapper?.category, 'siege');
  assert.equal(sapper?.label, 'Param/Value/lib_MTOD_1EDBBE28');
  assert.equal(sapper?.respawnSeconds, 150);
  assert.deepEqual(sapper?.mercs, [{ unit: 'MercGoblinSapperLaner', count: 1 }]);
  assert.equal(sapper?.defenderScaling, 'MercGoblinSapperDefenderScaling');
});

test("the map's own uncalled helper is a camp type of its own; the base data's isn't", () => {
  const ids = readCampTypes([ENUMS, BASE, MAP], 2).map((c) => c.id);
  assert.ok(ids.includes('GnollMercType'));
  assert.ok(!ids.includes('HellbatMercType'));
});

test("the map's own setters of one camp type are alternatives, each a camp type of its own", () => {
  const ENUM = `
const int libMapM_ge_JungleCampDefenderTypes_BruiserCamp3 = 9;
const int libMapM_ge_JungleCampMercTypes_BruiserCamp3 = 9;
`;
  const HANAMURA = `
void libMHmu_gf_InitVisionMercCampBruiserCamp3 () {
    int lv_campType;
    lv_campType = (libMapM_ge_JungleCampMercTypes_BruiserCamp3);
    libMapM_gv_dataJungleCampDefenderData[lv_campType].lv_creepUnitTypes[1] = "MercDefenderHenchman1";
    libMapM_gv_dataJungleCampDefenderData[lv_campType].lv_creepUnitTypes[2] = "MercDefenderHenchman2";
}

void libMHmu_gf_InitKnightsMercCampBruiserCamp3 () {
    int lv_campType;
    lv_campType = (libMapM_ge_JungleCampMercTypes_BruiserCamp3);
    libMapM_gv_dataJungleCampDefenderData[lv_campType].lv_creepUnitTypes[1] = "MercDefenderRangedMage";
    libMapM_gv_dataJungleCampDefenderData[lv_campType].lv_creepUnitTypes[2] = "MercDefenderMeleeKnight";
}
`;
  const camps = readCampTypes([ENUMS + ENUM, BASE, HANAMURA], 2);
  const vision = camps.find((c) => c.id === 'VisionMercCampBruiserCamp3');
  const knights = camps.find((c) => c.id === 'KnightsMercCampBruiserCamp3');
  assert.equal(vision?.category, 'bruiser');
  assert.deepEqual(
    vision?.defenders.map((d) => d.unit),
    ['MercDefenderHenchman1', 'MercDefenderHenchman2'],
  );
  assert.deepEqual(
    knights?.defenders.map((d) => d.unit),
    ['MercDefenderRangedMage', 'MercDefenderMeleeKnight'],
  );
  assert.ok(!camps.some((c) => c.id === 'BruiserCamp3'));
});

test("an actor's portraits are its GroupIcon's images, one per team, its parent's when it has none", () => {
  const actors = readActors([
    `<Catalog>
      <CActorUnit id="TownTownHallL2" parent="StormBuilding">
        <GroupIcon>
          <Image value="Assets\\Textures\\Storm_UI_InGame_TargetInfoPanel_Unit_BoE_Building_Fort_Heaven.dds" />
          <Image value="Assets\\Textures\\Storm_UI_InGame_TargetInfoPanel_Unit_BoE_Building_Fort_Hell.dds" />
        </GroupIcon>
        <InfoText value="Actor/InfoText/TownTownHallL2" />
      </CActorUnit>
      <CActorUnit id="TownTownHallL3" parent="TownTownHallL2" />
    </Catalog>`,
  ]);
  assert.deepEqual(actors.get('TownTownHallL2')?.portraits, [
    'storm_ui_ingame_targetinfopanel_unit_boe_building_fort_heaven',
    'storm_ui_ingame_targetinfopanel_unit_boe_building_fort_hell',
  ]);
  assert.equal(actors.get('TownTownHallL2')?.description, 'Actor/InfoText/TownTownHallL2');
  assert.equal(actors.get('TownTownHallL3')?.parent, 'TownTownHallL2');
});

test("a veterancy behaviour's levels: what each adds, by field", () => {
  const levels = readVeterancy([
    `<Catalog>
      <CBehaviorVeterancy id="OgreDefenderScaling">
        <VeterancyLevelArray />
        <VeterancyLevelArray MinVeterancyXP="1">
          <Modification KillXPBonus="2">
            <DamageDealtScaled index="Basic" value="1" />
            <VitalMaxArray index="Life" value="40" />
          </Modification>
        </VeterancyLevelArray>
      </CBehaviorVeterancy>
    </Catalog>`,
  ]).get('OgreDefenderScaling');
  assert.deepEqual(levels, [
    {},
    { KillXPBonus: 2, 'DamageDealtScaled.Basic': 1, 'VitalMaxArray.Life': 40 },
  ]);
});

test('scaling ticks: their length and cap, from the base scripts', () => {
  assert.deepEqual(
    readScalingTicks([
      'const int libCore_gv_dataScalingMaxScalingTicks = 60;',
      '    libGame_gv_bALScalingTimerDuration = 60.0;',
    ]),
    { tickSeconds: 60, maxTicks: 60 },
  );
});

test("strings: a map mod's win over the base data's", () => {
  const strings = readStrings([
    'Unit/Name/TerranHellbatDefender=Hellbat\nUnit/Name/KingsCore=Core',
    'Unit/Name/TerranHellbatDefender=Gnoll',
  ]);
  assert.equal(strings.get('Unit/Name/TerranHellbatDefender'), 'Gnoll');
  assert.equal(strings.get('Unit/Name/KingsCore'), 'Core');
});

test("a map's mods load after the base data, each after those it depends on", () => {
  const mod = (dependencies: string[]) => ({
    dependencies,
    xml: [],
    galaxy: [],
    strings: new Map(),
  });
  const mods = new Map([
    ['heroesdata', mod([])],
    ['infernalshrines', mod(['infernalshrinesdata'])],
    ['infernalshrinesdata', mod(['heavenhell'])],
    ['heavenhell', mod([])],
  ]);
  assert.deepEqual(loadOrder(['infernalshrines'], mods), [
    'heroesdata',
    'heavenhell',
    'infernalshrinesdata',
    'infernalshrines',
  ]);
});
