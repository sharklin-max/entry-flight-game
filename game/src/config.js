// Emberwing Courier — configuration: world, aircraft, missions, tuning.
// Every number here is real and used by the game; the title cites the same
// counts (6 missions, 3 aircraft, 30 rings, 4 islands).

export const WORLD = {
  size: 6400, // metres, square world centred on (0, 0)
  seaLevel: 0,
  seed: 20261126,
  gravity: 9.81,
  airDensity: 1.225,
};

// ---------------------------------------------------------------------------
// Aircraft. Each one is a real choice: different stall speed, top speed,
// fuel capacity and handling. Unlocks are earned by mission stars.
// ---------------------------------------------------------------------------
export const AIRCRAFT = [
  {
    id: 'kestrel',
    name: 'Kestrel',
    role: 'STOL bush plane',
    desc: 'Forgiving short-field flyer. Slow, but sips fuel and lands anywhere.',
    topSpeed: 62, // m/s
    cruiseSpeed: 48,
    stallSpeed: 21,
    climbRate: 9,
    turnRate: 0.55, // nominal; physics now turns at the coordinated rate g*tan(roll)/v
    fuelLitres: 120,
    burnRate: 0.55, // litres/s at full throttle
    handling: 1.0,
    gearFixed: true,
    colour: 0xd94f30, // ember red
    accent: 0xf2e6c9,
    unlockStars: 0,
  },
  {
    id: 'albatross',
    name: 'Albatross',
    role: 'Fast courier',
    desc: 'Built for the ring courses. Quick and sharp, but thirsty and twitchy.',
    topSpeed: 88,
    cruiseSpeed: 66,
    stallSpeed: 28,
    climbRate: 13,
    turnRate: 0.72, // nominal; physics now turns at the coordinated rate g*tan(roll)/v
    fuelLitres: 95,
    burnRate: 0.85,
    handling: 1.25,
    gearFixed: false,
    colour: 0x2e6fb0, // sea blue
    accent: 0xf5f5f5,
    unlockStars: 4,
  },
  {
    id: 'condor',
    name: 'Condor',
    role: 'Heavy lifter',
    desc: 'Hauls the big cargo loads. Steady as a rock, needs a long runway.',
    topSpeed: 70,
    cruiseSpeed: 55,
    stallSpeed: 26,
    climbRate: 7,
    turnRate: 0.42, // nominal; physics now turns at the coordinated rate g*tan(roll)/v
    fuelLitres: 180,
    burnRate: 0.7,
    handling: 0.8,
    gearFixed: false,
    colour: 0x4a7a3a, // jungle green
    accent: 0xe8d27a,
    unlockStars: 8,
  },
];

// ---------------------------------------------------------------------------
// Islands and airstrips. Coordinates are metres; +x east, -z north.
// ---------------------------------------------------------------------------
export const ISLANDS = [
  { name: 'Ember Isle', x: 0, z: 300, radius: 1500, peak: 260, volcano: true },
  { name: 'North Isle', x: -400, z: -2100, radius: 900, peak: 120, volcano: false },
  { name: 'Lagoon Atoll', x: 1900, z: 900, radius: 750, peak: 26, volcano: false },
  { name: 'Cliff Isle', x: -2100, z: 1400, radius: 420, peak: 190, volcano: false },
];

export const RUNWAYS = [
  {
    id: 'ember-field',
    name: 'Ember Field',
    island: 'Ember Isle',
    x: -150, z: 1150, heading: 90, // degrees, runway points east
    length: 620, width: 42,
    surface: 'asphalt',
  },
  {
    id: 'north-strip',
    name: 'North Strip',
    island: 'North Isle',
    x: -400, z: -2100, heading: 10,
    length: 520, width: 36,
    surface: 'grass',
  },
  {
    id: 'cliff-strip',
    name: 'Cliff Strip',
    island: 'Cliff Isle',
    x: -2100, z: 1400, heading: 160,
    length: 230, width: 26,
    surface: 'dirt',
  },
];

// ---------------------------------------------------------------------------
// Missions. Rings are {x, y, z} ring centres; drops are {x, z, r} targets.
// Times are seconds. Stars: 3 = gold time + no damage, 2 = within par time,
// 1 = finished at all.
// ---------------------------------------------------------------------------
export const MISSIONS = [
  {
    id: 'm1-first-light',
    no: 1,
    name: 'First Light',
    brief:
      'Dawn over the Ember Isles. Take off from Ember Field, thread the four beacon rings over the lagoon, then put her down gently on North Strip. Keep it smooth: a hard landing costs you.',
    aircraft: 'kestrel',
    startRunway: 'ember-field',
    timeOfDay: 'dawn',
    weather: 'calm',
    wind: { speed: 3, dir: 200 },
    timeLimit: 420,
    parTime: 240,
    fuelStart: 1.0,
    rings: [
      { x: 950, y: 170, z: 850 },
      { x: 1300, y: 170, z: 900 },
      { x: 1900, y: 150, z: 900 },
      { x: 1200, y: 200, z: -600 },
    ],
    landAt: 'north-strip',
    cargo: 0,
    reward: 120,
  },
  {
    id: 'm2-ring-runner',
    no: 2,
    name: 'Ring Runner',
    brief:
      'Eight rings over the lagoon, against the clock. Bank hard, keep the throttle buried, and do not clip a ring edge — a missed ring costs 15 seconds and the bonus.',
    aircraft: 'albatross',
    startRunway: 'ember-field',
    timeOfDay: 'noon',
    weather: 'calm',
    wind: { speed: 5, dir: 90 },
    timeLimit: 300,
    parTime: 180,
    fuelStart: 1.0,
    rings: [
      { x: 1050, y: 140, z: 650 },
      { x: 1500, y: 160, z: 1100 },
      { x: 2100, y: 120, z: 700 },
      { x: 2300, y: 200, z: 1200 },
      { x: 1700, y: 240, z: 1400 },
      { x: 1100, y: 180, z: 1300 },
      { x: 600, y: 140, z: 1000 },
      { x: 300, y: 180, z: 1500 },
    ],
    landAt: 'ember-field',
    cargo: 0,
    reward: 200,
  },
  {
    id: 'm3-cargo-drop',
    no: 3,
    name: 'Cargo Drop',
    brief:
      'Three supply crates for the lagoon research camp. Fly low and steady over each marked drop zone and release with Space. Crates landing inside the painted circle score full marks.',
    aircraft: 'condor',
    startRunway: 'ember-field',
    timeOfDay: 'afternoon',
    weather: 'breeze',
    wind: { speed: 8, dir: 140 },
    timeLimit: 480,
    parTime: 300,
    fuelStart: 1.0,
    rings: [],
    drops: [
      { x: 1700, z: 700, r: 40 },
      { x: 2050, z: 1050, r: 40 },
      { x: 1500, z: 1200, r: 40 },
    ],
    landAt: 'ember-field',
    cargo: 3,
    reward: 260,
  },
  {
    id: 'm4-storm-crossing',
    no: 4,
    name: 'Storm Crossing',
    brief:
      'A squall line sits between you and North Strip. Six rings mark the safe corridor through the weather. Gusts will shove you sideways — fly the rings, not the compass.',
    aircraft: 'kestrel',
    startRunway: 'ember-field',
    timeOfDay: 'dusk',
    weather: 'storm',
    wind: { speed: 14, dir: 260 },
    timeLimit: 420,
    parTime: 260,
    fuelStart: 1.0,
    rings: [
      { x: 800, y: 200, z: 600 },
      { x: 1200, y: 220, z: -200 },
      { x: 600, y: 200, z: -1200 },
      { x: -100, y: 200, z: -1800 },
      { x: -400, y: 160, z: -2000 },
      { x: -400, y: 150, z: -2250 },
    ],
    landAt: 'north-strip',
    cargo: 0,
    reward: 340,
  },
  {
    id: 'm5-cliff-rescue',
    no: 5,
    name: 'Cliff Rescue',
    brief:
      'A hiker is stranded on Cliff Isle. Land on the 230-metre dirt strip — short, uphill, no second chances — pick her up, then get airborne again and bring her home to Ember Field.',
    aircraft: 'kestrel',
    startRunway: 'ember-field',
    timeOfDay: 'morning',
    weather: 'breeze',
    wind: { speed: 7, dir: 320 },
    timeLimit: 600,
    parTime: 360,
    fuelStart: 1.0,
    rings: [
      { x: -1200, y: 200, z: 1200 },
      { x: -1800, y: 220, z: 1400 },
    ],
    landAt: 'cliff-strip',
    pickup: true,
    landAtFinal: 'ember-field',
    cargo: 0,
    reward: 420,
  },
  {
    id: 'm6-volcano-run',
    no: 6,
    name: 'Volcano Run',
    brief:
      'Night flight around the smoking cone. Ten rings circle the volcano in the dark, lit by lava and your own landing light. Thread them all, then land back at Ember Field by the runway lights.',
    aircraft: 'albatross',
    startRunway: 'ember-field',
    timeOfDay: 'night',
    weather: 'calm',
    wind: { speed: 6, dir: 45 },
    timeLimit: 540,
    parTime: 330,
    fuelStart: 1.0,
    rings: [
      { x: 700, y: 260, z: 300 },
      { x: 900, y: 320, z: -200 },
      { x: 500, y: 380, z: -700 },
      { x: -100, y: 420, z: -800 },
      { x: -600, y: 380, z: -500 },
      { x: -800, y: 320, z: 100 },
      { x: -600, y: 260, z: 700 },
      { x: 0, y: 300, z: 1000 },
      { x: 400, y: 340, z: 800 },
      { x: 650, y: 280, z: 500 },
    ],
    landAt: 'ember-field',
    cargo: 0,
    reward: 500,
  },
  {
    id: 'm7-ember-douse',
    no: 7,
    name: 'Ember Douse',
    brief:
      'Wildfire on the volcano slopes! Skim the sea east of Ember Isle to scoop water — gear up, under 7 m, 25–55 m/s — then climb and drop it on the three fires. Each load holds three drops; a good drop douses a fire. Thread the two guide rings on the way out, then bring her home to Ember Field.',
    aircraft: 'condor',
    startRunway: 'ember-field',
    timeOfDay: 'afternoon',
    weather: 'breeze',
    wind: { speed: 8, dir: 140 },
    timeLimit: 600,
    parTime: 420,
    fuelStart: 1.0,
    rings: [
      { x: 1500, y: 60, z: 400 },
      { x: 2100, y: 60, z: 500 },
    ],
    fires: [
      { x: 300, z: 100, r: 45 },
      { x: -260, z: -220, r: 45 },
      { x: 140, z: 420, r: 45 },
    ],
    scoopPoint: { x: 2800, z: 200 },
    landAt: 'ember-field',
    cargo: 0,
    reward: 560,
  },
];

// ---------------------------------------------------------------------------
// Scoring and tuning.
// ---------------------------------------------------------------------------
export const SCORE = {
  ring: 100,
  ringComboStep: 25, // extra per consecutive ring without a miss
  ringMissPenaltySec: 15,
  dropBullseye: 250,
  dropInner: 150,
  dropOuter: 60,
  fireBullseye: 250, // water dropped within a quarter of a fire's radius
  fireInner: 150,
  fireOuter: 60,
  waterDropCost: 0.33, // tank fraction spent per water drop (3 drops a load)
  scoopRate: 0.5, // tank fraction per second while skimming the sea
  scoopMaxAlt: 7, // metres above the sea surface while scooping
  scoopMinSpeed: 25,
  scoopMaxSpeed: 55,
  landingBase: 200,
  landingPerfectBonus: 300, // vertical speed under 2 m/s, on centreline
  timeBonusPerSec: 5, // seconds under par
  damagePenaltyPerPoint: 4,
  crashPenalty: 0, // a crash ends the mission with the score kept so far
};

export const TIME_OF_DAY = {
  dawn: { sun: 0.18, sky: 0xffb36b, fog: 0xf7c9a0, ambient: 0.55, sunColor: 0xffd9a0 },
  morning: { sun: 0.55, sky: 0x8ec8ee, fog: 0xcfe6f2, ambient: 0.75, sunColor: 0xfff2d0 },
  noon: { sun: 0.95, sky: 0x6fb7f0, fog: 0xd6ecf7, ambient: 0.9, sunColor: 0xffffff },
  afternoon: { sun: 0.7, sky: 0x7fb8e8, fog: 0xdcecf5, ambient: 0.8, sunColor: 0xfff0c0 },
  dusk: { sun: 0.12, sky: 0xe07a4e, fog: 0xe8a06a, ambient: 0.5, sunColor: 0xff9a55 },
  night: { sun: -0.25, sky: 0x0a1428, fog: 0x0e1c33, ambient: 0.28, sunColor: 0x9ab8ff },
};

export const WEATHER = {
  calm: { gust: 0.4, rain: 0, cloudCover: 0.25, visibility: 9000 },
  breeze: { gust: 1.2, rain: 0, cloudCover: 0.4, visibility: 8000 },
  storm: { gust: 3.2, rain: 1, cloudCover: 0.9, visibility: 2600 },
};

export function totalRings() {
  return MISSIONS.reduce((n, m) => n + m.rings.length, 0);
}

export function aircraftById(id) {
  return AIRCRAFT.find((a) => a.id === id) || AIRCRAFT[0];
}

export function runwayById(id) {
  return RUNWAYS.find((r) => r.id === id) || RUNWAYS[0];
}
