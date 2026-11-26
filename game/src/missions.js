// Emberwing Courier — missions. One state machine per sortie: rings to
// thread, crates to drop, a strip to land on (and, for the rescue, a
// passenger to pick up and bring home). Scoring is transparent: every
// point has a named reason, shown on the debrief screen.

import { SCORE } from './config.js';
import { headingDeg, flatDistance } from './physics.js';

export class Mission {
  constructor(def, aircraftSpec) {
    this.def = def;
    this.spec = aircraftSpec;
    this.phase = 'briefing'; // briefing | flying | pickup | returning | done | crashed
    this.ringIndex = 0;
    this.ringsPassed = 0;
    this.ringsMissed = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.dropsDone = 0;
    this.dropsScored = [];
    this.score = 0;
    this.scoreLog = [];
    this.elapsed = 0;
    this.fuel = aircraftSpec.fuelLitres * def.fuelStart;
    this.damage = 0;
    this.landed = false;
    this.landingQuality = null;
    this.pickedUp = false;
    this.crates = []; // falling crates {x, y, z, vx, vy, vz}
    this.water = 0; // 0..1 tank fraction (fire mission: scoop from the sea)
    this.firesDone = 0;
    this.firesScored = [];
    this.dousedFires = new Set(); // indices into def.fires already put out
    this.scooping = false;
    this.finished = false;
    this.stars = 0;
    this.failReason = null;
    this.timeBonus = 0;
  }

  start() {
    this.phase = 'flying';
    this.elapsed = 0;
  }

  addScore(points, reason) {
    this.score += points;
    this.scoreLog.push({ points, reason, at: Math.round(this.elapsed) });
  }

  // Called when the plane passes through a ring's plane.
  ringPassed(ring) {
    this.ringsPassed++;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const pts = SCORE.ring + (this.combo - 1) * SCORE.ringComboStep;
    this.addScore(pts, `Ring ${this.ringsPassed} (combo x${this.combo})`);
    this.ringIndex++;
    return pts;
  }

  ringMissed(ring) {
    this.ringsMissed++;
    this.combo = 0;
    this.ringIndex++;
    this.scoreLog.push({ points: 0, reason: 'Ring missed (+15s)', at: Math.round(this.elapsed) });
    this.elapsed += SCORE.ringMissPenaltySec;
  }

  // A crate hits the ground: score by distance from the zone centre.
  crateLanded(crate, zone) {
    const d = flatDistance(crate, zone.def);
    let pts = 0;
    let label = 'Crate outside the zone';
    if (d <= zone.def.r * 0.25) {
      pts = SCORE.dropBullseye;
      label = 'Crate bullseye!';
    } else if (d <= zone.def.r * 0.6) {
      pts = SCORE.dropInner;
      label = 'Crate inside the zone';
    } else if (d <= zone.def.r) {
      pts = SCORE.dropOuter;
      label = 'Crate on the edge';
    }
    this.dropsDone++;
    this.dropsScored.push({ pts, d: Math.round(d) });
    if (pts > 0) this.addScore(pts, label);
    else this.scoreLog.push({ points: 0, reason: label, at: Math.round(this.elapsed) });
    return { pts, d };
  }

  // A water load hits the ground: score by distance from the nearest
  // fire that is still burning. Any drop inside a fire's radius douses it.
  waterDropped(drop, fire, fireIndex) {
    const d = flatDistance(drop, fire.def);
    let pts = 0;
    let label = 'Water missed the fires';
    if (d <= fire.def.r * 0.25) {
      pts = SCORE.fireBullseye;
      label = 'Fire doused — dead on!';
    } else if (d <= fire.def.r * 0.6) {
      pts = SCORE.fireInner;
      label = 'Fire doused!';
    } else if (d <= fire.def.r) {
      pts = SCORE.fireOuter;
      label = 'Fire doused on the edge';
    }
    if (pts > 0) {
      fire.done = true;
      this.dousedFires.add(fireIndex);
      this.firesDone++;
      this.firesScored.push({ pts, d: Math.round(d) });
      this.addScore(pts, label);
    } else {
      this.scoreLog.push({ points: 0, reason: label, at: Math.round(this.elapsed) });
    }
    return { pts, d };
  }

  // Landing judged on vertical speed, centreline and gear.
  judgeLanding(vs, centreOffset, gearDown, runway) {
    const quality = { vs, centreOffset, gearDown, runway: runway ? runway.name : 'off-strip' };
    let pts = SCORE.landingBase;
    let label = 'Landed';
    if (vs < 2 && Math.abs(centreOffset) < 12 && runway) {
      pts += SCORE.landingPerfectBonus;
      label = 'Perfect landing';
      quality.rating = 'perfect';
    } else if (vs < 3.5 && runway) {
      quality.rating = 'good';
      label = 'Good landing';
    } else {
      quality.rating = 'rough';
      label = runway ? 'Rough landing' : 'Off-strip landing';
      pts = Math.round(pts * 0.5);
    }
    this.landingQuality = quality;
    this.addScore(pts, `${label} (${runway ? runway.name : 'rough ground'})`);
    return quality;
  }

  // Mission complete: time bonus, damage penalty, stars.
  finish() {
    if (this.finished) return;
    this.finished = true;
    this.phase = 'done';
    const underPar = Math.max(0, this.def.parTime - this.elapsed);
    this.timeBonus = Math.round(underPar * SCORE.timeBonusPerSec);
    if (this.timeBonus > 0) this.addScore(this.timeBonus, `Time bonus (${Math.round(underPar)}s under par)`);
    const dmgPenalty = Math.round(this.damage * SCORE.damagePenaltyPerPoint);
    if (dmgPenalty > 0) {
      this.score = Math.max(0, this.score - dmgPenalty);
      this.scoreLog.push({ points: -dmgPenalty, reason: `Damage penalty (${Math.round(this.damage)}%)`, at: Math.round(this.elapsed) });
    }
    // Stars: 3 = under par with no damage, 2 = within par time, 1 = done.
    if (this.elapsed <= this.def.parTime && this.damage < 5) this.stars = 3;
    else if (this.elapsed <= this.def.timeLimit) this.stars = 2;
    else this.stars = 1;
    if (this.def.id === 'm5-cliff-rescue' && !this.pickedUp) this.stars = 0;
  }

  crash(reason) {
    if (this.finished) return;
    this.finished = true;
    this.phase = 'crashed';
    this.failReason = reason;
    this.stars = 0;
  }

  // Next objective text for the HUD.
  objectiveText() {
    const d = this.def;
    if (this.phase === 'crashed') return `Crashed — ${this.failReason || ''}`;
    if (this.phase === 'done') return 'Mission complete!';
    if (d.pickup && this.phase === 'pickup') return 'Pick up the hiker on Cliff Strip, then return home';
    if (d.pickup && this.phase === 'returning') return 'Hiker aboard — land at Ember Field';
    if (this.ringIndex < d.rings.length) {
      return `Ring ${this.ringIndex + 1} of ${d.rings.length} — ${this.ringsPassed} passed`;
    }
    if (d.drops && this.dropsDone < d.drops.length) {
      return `Drop crate ${this.dropsDone + 1} of ${d.drops.length} (Space to release)`;
    }
    if (d.fires) {
      if (this.water < SCORE.waterDropCost) {
        return `Skim the sea to scoop water — under ${SCORE.scoopMaxAlt} m, gear up (tank ${Math.round(this.water * 100)}%)`;
      }
      if (this.firesDone < d.fires.length) {
        return `Douse fire ${this.firesDone + 1} of ${d.fires.length} — Space to drop water (tank ${Math.round(this.water * 100)}%)`;
      }
    }
    if (d.landAt) {
      const dest = this.phase === 'returning' ? d.landAtFinal : d.landAt;
      return `Land at ${dest === 'ember-field' ? 'Ember Field' : dest === 'north-strip' ? 'North Strip' : 'Cliff Strip'}`;
    }
    return 'Fly!';
  }

  // Unit vector through a ring in the direction of travel: toward the
  // next ring, or the landing runway for the last one.
  ringNormal(index) {
    const d = this.def;
    const cur = d.rings[index];
    let nxt = d.rings[index + 1] || null;
    if (!nxt && d.landAt) {
      const rw = this.runwayLookup(d.landAt);
      if (rw) nxt = { x: rw.x, y: cur.y, z: rw.z };
    }
    if (!nxt) return { x: 0, y: 0, z: -1 };
    const dx = nxt.x - cur.x;
    const dy = nxt.y - cur.y;
    const dz = nxt.z - cur.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    return { x: dx / len, y: dy / len, z: dz / len };
  }

  // Bearing (degrees) and distance to the current target, for the HUD arrow.
  targetInfo(planePos) {
    const d = this.def;
    let target = null;
    if (this.ringIndex < d.rings.length) {
      const r = d.rings[this.ringIndex];
      // Line up behind the hoop first: aim 300 m back along the ring's
      // normal, so the run through the hoop is along the course. Flying
      // straight at the centre from the side crosses the ring plane far
      // from the hoop and counts as a miss. The switch to the ring
      // itself keys on reaching the approach point, not on nearness to
      // the ring, so the line-up is never cut short.
      const n = this.ringNormal(this.ringIndex);
      const ap = { x: r.x - n.x * 300, y: r.y, z: r.z - n.z * 300 };
      const distAp = Math.hypot(ap.x - planePos.x, ap.z - planePos.z);
      target = distAp > 120 ? ap : { x: r.x, y: r.y, z: r.z };
    } else if (d.drops && this.dropsDone < d.drops.length) {
      const z = d.drops[this.dropsDone];
      target = { x: z.x, y: 60, z: z.z };
    } else if (d.fires && this.firesDone < d.fires.length) {
      if (this.water < SCORE.waterDropCost && d.scoopPoint) {
        target = { x: d.scoopPoint.x, y: 5, z: d.scoopPoint.z };
      } else {
        const idx = d.fires.findIndex((_, i) => !this.dousedFires.has(i));
        if (idx >= 0) {
          const fz = d.fires[idx];
          target = { x: fz.x, y: 260, z: fz.z };
        }
      }
    } else if (d.landAt) {
      const destId = this.phase === 'returning' ? d.landAtFinal : d.landAt;
      const rw = this.runwayLookup(destId);
      if (rw) target = { x: rw.x, y: rw.altitude + 10, z: rw.z };
    }
    if (!target) return null;
    const dx = target.x - planePos.x;
    const dz = target.z - planePos.z;
    // Compass bearing: 0 = north (-z), clockwise.
    let bearing = (Math.atan2(dx, -dz) * 180) / Math.PI;
    bearing = ((bearing % 360) + 360) % 360;
    return {
      bearing: Math.round(bearing),
      distance: Math.round(Math.sqrt(dx * dx + dz * dz)),
      altDiff: Math.round(target.y - planePos.y),
    };
  }

  // Set by game.js so missions can resolve runway ids.
  setRunwayLookup(fn) {
    this.runwayLookup = fn;
  }

  runwayLookup() {
    return null;
  }
}

// Campaign progress, kept in localStorage.
export class Campaign {
  constructor() {
    this.key = 'emberwing-courier-v1';
    this.data = { stars: {}, best: {}, credits: 0, aircraft: 'kestrel' };
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) this.data = { ...this.data, ...JSON.parse(raw) };
    } catch (e) {
      // Storage unavailable (private mode): play without saving.
    }
  }

  save() {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.data));
    } catch (e) {
      // Ignore storage failures.
    }
  }

  totalStars() {
    return Object.values(this.data.stars).reduce((a, b) => a + b, 0);
  }

  recordMission(mission) {
    const id = mission.def.id;
    const prev = this.data.stars[id] || 0;
    this.data.stars[id] = Math.max(prev, mission.stars);
    const prevBest = this.data.best[id] || 0;
    this.data.best[id] = Math.max(prevBest, mission.score);
    if (mission.stars > 0) this.data.credits += mission.def.reward;
    this.save();
  }

  isAircraftUnlocked(spec) {
    return this.totalStars() >= spec.unlockStars;
  }
}
