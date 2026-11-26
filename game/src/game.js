// Emberwing Courier — the game itself. Main loop, screens, camera, rings,
// crates, landings, crashes, particles and scoring. The flight model lives
// in physics.js, the world in terrain.js, the instruments in hud.js.

import * as THREE from '../vendor/three.module.min.js';
import {
  WORLD, AIRCRAFT, MISSIONS, RUNWAYS, TIME_OF_DAY, WEATHER, SCORE,
  aircraftById, runwayById, totalRings,
} from './config.js';
import { Terrain, makeRng } from './terrain.js';
import { AircraftMesh } from './aircraft.js';
import { FlightState, headingDeg, flatDistance } from './physics.js';
import { Mission, Campaign } from './missions.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { SoundBank } from './audio.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Particles: one Points cloud, recycled. Smoke, sparks, splash, explosion.
// ---------------------------------------------------------------------------
class Particles {
  constructor(scene, max = 900) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -9999;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({
      size: 2.2, vertexColors: true, transparent: true, opacity: 0.9,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.cursor = 0;
  }

  spawn(p, v, count, color, life, spread) {
    const c = new THREE.Color(color);
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      this.pos[i * 3] = p.x + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * spread;
      this.vel[i * 3] = v.x + (Math.random() - 0.5) * 12;
      this.vel[i * 3 + 1] = v.y + (Math.random() - 0.5) * 12;
      this.vel[i * 3 + 2] = v.z + (Math.random() - 0.5) * 12;
      this.col[i * 3] = c.r;
      this.col[i * 3 + 1] = c.g;
      this.col[i * 3 + 2] = c.b;
      this.life[i] = life * (0.6 + Math.random() * 0.7);
      this.maxLife[i] = this.life[i];
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -9999;
        continue;
      }
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.vel[i * 3 + 1] -= 4 * dt; // settle
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------
export class Game {
  constructor() {
    this.canvas = $('game-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.scene = null;
    this.camera = null;
    this.terrain = null;
    this.plane = null;
    this.flight = new FlightState();
    this.sound = new SoundBank();
    this.hud = new Hud($('hud-root'));
    this.input = new Input(this.canvas);
    this.campaign = new Campaign();
    this.mission = null;
    this.missionDef = null;
    this.aircraftSpec = AIRCRAFT[0];
    this.screen = 'title'; // title | hangar | missions | briefing | flying | paused | debrief | crashed | help
    this.cameraMode = 'chase';
    this.time = 0;
    this.clock = new THREE.Clock();
    this.particles = null;
    this.crates = [];
    this.waterDrops = []; // falling water loads (fire mission)
    this.ringNormals = [];
    this.airborneTime = 0; // seconds continuously airborne (landing gate)
    this.liftoffPos = null; // position where the current flight began
    this.pickupTimer = 0;
    this.alarmTimer = 0;
    this.shotMode = null;
    this.onFirstFrame = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    if (this.camera) {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    }
  }

  // -- Screens ---------------------------------------------------------------
  show(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.remove('active');
    const el = $(id);
    if (el) el.classList.add('active');
  }

  showTitle() {
    this.screen = 'title';
    this.show('screen-title');
    $('title-stats').textContent =
      `${this.campaign.totalStars()}★ earned · ${this.campaign.data.credits} credits · best score ${Math.max(0, ...Object.values(this.campaign.data.best))}`;
  }

  showHangar() {
    this.screen = 'hangar';
    this.show('screen-hangar');
    const list = $('hangar-list');
    list.innerHTML = '';
    for (const spec of AIRCRAFT) {
      const unlocked = this.campaign.isAircraftUnlocked(spec);
      const card = document.createElement('button');
      card.className = 'card' + (this.aircraftSpec.id === spec.id ? ' selected' : '') + (unlocked ? '' : ' locked');
      card.innerHTML = `<h3>${spec.name}</h3><div class="role">${spec.role}</div>`
        + `<p>${spec.desc}</p>`
        + `<div class="specs">Top ${Math.round(spec.topSpeed * 1.944)} kt · Stall ${Math.round(spec.stallSpeed * 1.944)} kt · Fuel ${spec.fuelLitres} L</div>`
        + (unlocked ? '' : `<div class="lock">🔒 Needs ${spec.unlockStars}★ (you have ${this.campaign.totalStars()}★)</div>`);
      card.addEventListener('click', () => {
        this.sound.ensure();
        this.sound.click();
        if (!unlocked) return;
        this.aircraftSpec = spec;
        this.campaign.data.aircraft = spec.id;
        this.campaign.save();
        this.showHangar();
      });
      list.appendChild(card);
    }
  }

  showMissions() {
    this.screen = 'missions';
    this.show('screen-missions');
    const list = $('missions-list');
    list.innerHTML = '';
    for (const def of MISSIONS) {
      const stars = this.campaign.data.stars[def.id] || 0;
      const best = this.campaign.data.best[def.id] || 0;
      const card = document.createElement('button');
      card.className = 'card mission';
      card.innerHTML = `<h3>${def.no}. ${def.name}</h3>`
        + `<p>${def.brief}</p>`
        + `<div class="specs">${def.rings.length} rings · ${def.fires ? def.fires.length + ' fires · ' : ''}${def.drops ? def.drops.length + ' drops · ' : ''}par ${Math.floor(def.parTime / 60)}:${String(def.parTime % 60).padStart(2, '0')} · reward ${def.reward} cr</div>`
        + `<div class="stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}${best ? ` · best ${best}` : ''}</div>`;
      card.addEventListener('click', () => {
        this.sound.ensure();
        this.sound.click();
        this.showBriefing(def);
      });
      list.appendChild(card);
    }
  }

  showBriefing(def) {
    this.missionDef = def;
    this.screen = 'briefing';
    this.show('screen-briefing');
    $('briefing-title').textContent = `${def.no}. ${def.name}`;
    $('briefing-text').textContent = def.brief;
    const spec = aircraftById(def.aircraft);
    $('briefing-plane').textContent = `Flown in the ${spec.name} (${spec.role}) — ${def.timeOfDay}, ${def.weather} weather, wind ${def.wind.speed} m/s from ${def.wind.dir}°. Time limit ${Math.floor(def.timeLimit / 60)}:${String(def.timeLimit % 60).padStart(2, '0')}.`;
  }

  // -- Mission setup ---------------------------------------------------------
  loadMission(def, specOverride) {
    const spec = specOverride || aircraftById(def.aircraft);
    this.missionDef = def;
    this.aircraftSpec = spec;
    this.mission = new Mission(def, spec);
    this.mission.setRunwayLookup((id) => runwayById(id));

    // Fresh scene per mission (time of day + weather change the light).
    if (this.scene) {
      this.scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (m.map) m.map.dispose();
            m.dispose();
          }
        }
      });
    }
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 12000);
    this.terrain = new Terrain(this.scene, makeRng(WORLD.seed));
    this.terrain.build(def.timeOfDay, def.weather);
    this.particles = new Particles(this.scene);
    this.plane = new AircraftMesh(spec);
    this.scene.add(this.plane.group);
    this.plane.setLandingLight(TIME_OF_DAY[def.timeOfDay].sun <= 0.2);

    // Rings, oriented along the course.
    const rings = this.terrain.buildRings(def.rings);
    this.ringNormals = [];
    for (let i = 0; i < rings.length; i++) {
      // Ring normal: toward the next ring, or the landing runway for the
      // last one. A runway def has no y, so use the ring's own altitude
      // (the undefined y used to make the last ring's normal NaN, so the
      // final ring could never be passed or missed and the mission could
      // never complete through the rings).
      const cur = def.rings[i];
      const nxtDef = def.rings[i + 1] || null;
      const nxt = nxtDef
        ? nxtDef
        : (() => { const rw = runwayById(def.landAt); return { x: rw.x, y: cur.y, z: rw.z }; })();
      const dir = new THREE.Vector3(nxt.x - cur.x, nxt.y - cur.y, nxt.z - cur.z).normalize();
      rings[i].group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      this.ringNormals.push(dir);
    }
    if (def.drops) this.terrain.buildDropZones(def.drops);
    else this.terrain.clearDropZones();
    if (def.fires) this.terrain.buildFires(def.fires);
    else this.terrain.clearFires();

    // Place the plane on the start runway.
    const rw = runwayById(def.startRunway);
    this.flight = new FlightState();
    this.flight.placeOnRunway(rw);
    this.input.throttle = 0;
    this.airborneTime = 0;
    this.crates = [];
    this.waterDrops = [];
    this.pickupTimer = 0;
    this.mission.start();
    this.screen = 'flying';
    this.show(null);
    this.hud.showToast(`${def.no}. ${def.name} — good luck!`, 2600);
    this.sound.ensure();
    this.updatePlaneMesh(0);
    this.updateCamera(1);
  }

  // -- Per-frame --------------------------------------------------------------
  loop() {
    requestAnimationFrame(() => this.loop());
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;
    if (this.screen === 'flying' && this.mission && !this.mission.finished) {
      this.stepFlying(dt);
    } else if (this.screen === 'title' || this.screen === 'hangar' || this.screen === 'missions') {
      // Idle orbit over the islands behind the menus.
      if (this.scene && this.camera) {
        const t = this.time * 0.02;
        this.camera.position.set(Math.sin(t) * 2400, 700, Math.cos(t) * 2400);
        this.camera.lookAt(0, 60, 300);
        this.terrain.update(dt, null, 1.2);
        this.renderer.render(this.scene, this.camera);
      }
    } else if (this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
    this.input.endFrame();
  }

  stepFlying(dt) {
    const f = this.flight;
    const m = this.mission;
    const spec = this.aircraftSpec;
    const wx = WEATHER[this.missionDef.weather];

    // Global keys.
    if (this.input.wasPressed('KeyP') || this.input.wasPressed('Escape')) {
      this.screen = 'paused';
      this.show('screen-pause');
      return;
    }
    if (this.input.wasPressed('KeyM')) {
      this.sound.setMuted(!this.sound.muted);
      this.hud.showToast(this.sound.muted ? 'Sound muted' : 'Sound on', 1200);
    }
    if (this.input.wasPressed('KeyC')) {
      this.cameraMode = this.cameraMode === 'chase' ? 'cockpit' : 'chase';
      this.plane.group.visible = this.cameraMode === 'chase';
      this.hud.showToast(this.cameraMode === 'chase' ? 'Chase camera' : 'Cockpit camera', 1200);
    }
    if (this.input.wasPressed('KeyR')) {
      this.loadMission(this.missionDef, spec);
      return;
    }
    if (this.input.wasPressed('KeyH')) {
      this.showHelp();
      return;
    }

    const ctl = this.input.readFlight(dt, f.throttle);
    if (ctl.gear && !spec.gearFixed) {
      f.gearDown = !f.gearDown;
      this.plane.setGearDown(f.gearDown);
      this.hud.showToast(f.gearDown ? 'Gear down' : 'Gear up', 1000);
    }

    // Fuel burn; empty tank = engine out.
    if (!f.onGround || f.throttle > 0.05) {
      m.fuel -= spec.burnRate * (0.25 + 0.75 * f.throttle) * dt;
    }
    if (m.fuel <= 0 && !f.engineOut) {
      m.fuel = 0;
      f.engineOut = true;
      this.sound.engineOff();
      this.hud.showToast('OUT OF FUEL — glide her down!', 3000);
    }

    // Current runway under the wheels (for landing judgement).
    f.currentRunway = this.runwayUnder(f.pos);

    const event = f.step(ctl, dt, spec, this.missionDef.wind, wx.gust, (x, z) => this.terrain.heightAt(x, z));
    m.elapsed += dt;

    // Time limit.
    if (m.elapsed > this.missionDef.timeLimit && !m.finished) {
      this.endCrash('time expired');
      return;
    }

    // Sea ditching.
    if (!f.onGround && f.pos.y < WORLD.seaLevel + 1.2 && this.terrain.heightAt(f.pos.x, f.pos.z) < 0) {
      this.splash(f.pos);
      this.endCrash('ditched in the sea');
      return;
    }

    const airborneBefore = this.airborneTime;
    const liftoffPos = this.liftoffPos;
    if (!f.onGround) {
      if (this.airborneTime === 0) this.liftoffPos = { x: f.pos.x, z: f.pos.z };
      this.airborneTime += dt;
    } else {
      this.airborneTime = 0;
      this.liftoffPos = null;
    }

    if (event) this.handleGroundEvent(event, airborneBefore, liftoffPos);

    // Water scooping (fire mission): skimming the sea fills the tank.
    if (this.missionDef.fires) this.updateScoop(dt);

    // Rings.
    this.checkRings();
    // Crates / water.
    if (ctl.drop && this.missionDef.cargo > 0 && m.dropsDone + m.crates.length < this.missionDef.cargo) {
      this.dropCrate();
    }
    if (ctl.drop && this.missionDef.fires && m.water >= SCORE.waterDropCost && !f.onGround) {
      this.dropWater();
    }
    this.updateCrates(dt);
    this.updateWaterDrops(dt);

    // Pickup (rescue mission): stand on Cliff Strip for 3 seconds.
    if (this.missionDef.pickup && m.phase === 'flying' && m.landed && f.onGround) {
      const rw = this.runwayUnder(f.pos);
      if (rw && rw.id === 'cliff-strip' && m.ringIndex >= this.missionDef.rings.length) {
        m.phase = 'pickup';
        this.pickupTimer = 3;
        this.hud.showToast('Hiker boarding… hold still', 3000);
      }
    }
    if (m.phase === 'pickup') {
      this.pickupTimer -= dt;
      if (this.pickupTimer <= 0) {
        m.pickedUp = true;
        m.phase = 'returning';
        m.addScore(150, 'Hiker aboard');
        this.hud.showToast('Hiker aboard — take off and head home!', 3000);
        this.sound.fanfare();
      }
    }

    // Damage smoke + stall alarm.
    if (m.damage > 25 && !f.onGround) {
      if (Math.random() < dt * 8) {
        this.particles.spawn(f.pos, { x: 0, y: 1, z: 0 }, 1, 0x555555, 1.4, 2);
      }
    }
    if (f.stalled) {
      this.alarmTimer -= dt;
      if (this.alarmTimer <= 0) {
        this.sound.alarm();
        this.alarmTimer = 0.7;
      }
    }

    this.updatePlaneMesh(dt);
    this.updateCamera(dt);
    this.terrain.update(dt, f.pos, (this.missionDef.wind.dir * Math.PI) / 180);
    this.particles.update(dt);
    this.sound.updateEngine(f.engineOut ? 0 : f.throttle, f.airspeed, wx.rain);
    this.hud.update(dt, f, m, spec, this.cameraMode);
    this.renderer.render(this.scene, this.camera);
  }

  runwayUnder(pos) {
    for (const rw of RUNWAYS) {
      const rad = (rw.heading * Math.PI) / 180;
      const dx = pos.x - rw.x;
      const dz = pos.z - rw.z;
      // Local frame: the runway direction is (sin h, -cos h) in (x, z)
      // because north is -z. The old signs (along = dx*sin + dz*cos,
      // across = dx*cos - dz*sin) rotated the tested rectangle by
      // twice the heading: a plane 12 m off the North Strip centreline
      // read as 32 m across and was judged off-strip, so a good
      // landing never completed the mission.
      const along = dx * Math.sin(rad) - dz * Math.cos(rad);
      const across = dx * Math.cos(rad) + dz * Math.sin(rad);
      if (Math.abs(along) < rw.length / 2 && Math.abs(across) < rw.width / 2) return rw;
    }
    return null;
  }

  handleGroundEvent(event, airborneBefore, liftoffPos) {
    const f = this.flight;
    const m = this.mission;
    const def = this.missionDef;
    if (event.type === 'crash') {
      this.explode(f.pos);
      this.sound.crash();
      this.endCrash(event.reason === 'belly landing' ? 'belly landing — gear was up' : 'impact with the ground');
      return;
    }
    if (event.type === 'hard-landing') {
      m.damage = Math.min(100, m.damage + 15);
      this.sound.touchdown(true);
      this.hud.showToast(`Hard landing! +15% damage`, 2000);
    } else {
      this.sound.touchdown(false);
    }
    // A landing only counts after a real flight: 5+ s airborne and 400+ m
    // from liftoff. Bouncing along the ground after a stall cannot farm
    // landing points, but a genuine repositioning flight still counts.
    const flownDist = liftoffPos
      ? Math.hypot(f.pos.x - liftoffPos.x, f.pos.z - liftoffPos.z)
      : 0;
    if (airborneBefore < 5 || flownDist < 400) {
      this.airborneTime = 0;
      if (f.engineOut && !this.runwayUnder(f.pos)) this.endCrash('out of fuel, stranded');
      return;
    }
    this.airborneTime = 0;
    // Landing scoring + mission progression.
    const rw = this.runwayUnder(f.pos);
    const centre = rw ? this.centreOffset(f.pos, rw) : 999;
    m.landed = true;
    const q = m.judgeLanding(event.vs, centre, f.gearDown, rw);
    this.hud.showToast(`${q.rating === 'perfect' ? 'Perfect landing!' : q.rating === 'good' ? 'Good landing' : 'Rough landing'} — ${q.runway}`, 2200);
    // Mission complete? All objectives done and down at the destination.
    const destId = m.phase === 'returning' ? def.landAtFinal : def.landAt;
    const ringsDone = m.ringIndex >= def.rings.length;
    const dropsDone = !def.drops || m.dropsDone >= def.drops.length;
    const firesDone = !def.fires || m.firesDone >= def.fires.length;
    const needPickup = def.pickup && !m.pickedUp;
    if (rw && rw.id === destId && ringsDone && dropsDone && firesDone && !needPickup) {
      this.finishMission();
    } else if (rw && rw.id === destId && (!ringsDone || !dropsDone || !firesDone || needPickup)) {
      this.hud.showToast('Not done yet — finish the objectives first', 2600);
    }
    if (f.engineOut && !(rw && rw.id === destId)) {
      this.endCrash('out of fuel, stranded');
    }
  }

  centreOffset(pos, rw) {
    const rad = (rw.heading * Math.PI) / 180;
    const dx = pos.x - rw.x;
    const dz = pos.z - rw.z;
    // Across-track distance from the centreline (same local frame as
    // runwayUnder: across = dx*cos h + dz*sin h).
    return dx * Math.cos(rad) + dz * Math.sin(rad);
  }

  checkRings() {
    const m = this.mission;
    const def = this.missionDef;
    if (m.ringIndex >= def.rings.length) return;
    const ring = this.terrain.rings[m.ringIndex];
    if (!ring || ring.passed || ring.missed) return;
    const n = this.ringNormals[m.ringIndex];
    const f = this.flight;
    const rel = { x: f.pos.x - ring.def.x, y: f.pos.y - ring.def.y, z: f.pos.z - ring.def.z };
    const along = rel.x * n.x + rel.y * n.y + rel.z * n.z;
    const radial = Math.sqrt(
      Math.max(0, rel.x * rel.x + rel.y * rel.y + rel.z * rel.z - along * along),
    );
    if (Math.abs(along) < 5) {
      if (radial < 24) {
        ring.passed = true;
        const pts = m.ringPassed(ring);
        this.sound.ringChime(m.combo);
        this.hud.showToast(`Ring ${m.ringsPassed}! +${pts}`, 1500);
        this.particles.spawn(ring.def, { x: 0, y: 0, z: 0 }, 26, 0xffc233, 1.1, 20);
      }
    } else if (along > 40 && radial > 24 && radial < 250) {
      // Flew past the ring plane outside the hoop: missed. The 40 m
      // margin (not 8) lets a pilot line up behind the ring and turn
      // onto the course without an instant miss for crossing the ring
      // plane's extension while manoeuvring. The radial < 250 guard
      // stops a false miss when the plane is still hundreds of metres
      // away laterally (e.g. right after the previous ring, when the
      // next ring's plane already lies behind the flight path): the
      // ring simply stays the target until the pilot genuinely flies
      // past it.
      ring.missed = true;
      m.ringMissed(ring);
      this.sound.ringMiss();
      this.hud.showToast('Ring missed! +15s', 1600);
    }
  }

  dropCrate() {
    const f = this.flight;
    const m = this.mission;
    if (f.onGround) return;
    const crate = {
      pos: { x: f.pos.x, y: f.pos.y - 2, z: f.pos.z },
      vel: { x: f.vel.x * 0.9, y: -1, z: f.vel.z * 0.9 },
      mesh: null,
    };
    const geo = new THREE.BoxGeometry(3, 2.4, 3);
    const mat = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.7 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(crate.pos);
    this.scene.add(mesh);
    crate.mesh = mesh;
    m.crates.push(crate);
    this.crates.push(crate);
    this.sound.dropThump();
    this.hud.showToast('Crate away!', 1200);
  }

  updateCrates(dt) {
    const m = this.mission;
    for (let i = this.crates.length - 1; i >= 0; i--) {
      const c = this.crates[i];
      c.vel.y -= 9.81 * dt * 0.55; // parachute drag
      c.vel.y = Math.max(c.vel.y, -14);
      c.pos.x += c.vel.x * dt;
      c.pos.y += c.vel.y * dt;
      c.pos.z += c.vel.z * dt;
      c.mesh.position.copy(c.pos);
      c.mesh.rotation.y += dt * 0.8;
      const ground = this.terrain.heightAt(c.pos.x, c.pos.z);
      if (c.pos.y <= ground + 1.2) {
        // Score against the next open drop zone.
        const zone = this.terrain.dropZones
          ? this.terrain.dropZones.find((z) => !z.done)
          : null;
        if (zone) {
          zone.done = true;
          const res = m.crateLanded(c, zone);
          this.hud.showToast(res.pts > 0 ? `Crate down! +${res.pts} (${res.d}m off)` : 'Crate missed the zone', 2000);
          if (res.pts > 0) this.sound.ringChime(2);
          this.particles.spawn(c.pos, { x: 0, y: 2, z: 0 }, 18, 0xd9c28a, 0.9, 6);
        }
        this.scene.remove(c.mesh);
        this.crates.splice(i, 1);
        const mi = m.crates.indexOf(c);
        if (mi >= 0) m.crates.splice(mi, 1);
      }
    }
  }

  // Skim the sea with the gear up, in the speed band, to fill the tank.
  updateScoop(dt) {
    const f = this.flight;
    const m = this.mission;
    const overSea = this.terrain.heightAt(f.pos.x, f.pos.z) < 0;
    const skimming = !f.onGround && overSea && f.pos.y < SCORE.scoopMaxAlt
      && f.airspeed >= SCORE.scoopMinSpeed && f.airspeed <= SCORE.scoopMaxSpeed
      && !f.gearDown;
    m.scooping = skimming;
    if (skimming && m.water < 1) {
      const wasFull = m.water >= 1;
      m.water = Math.min(1, m.water + SCORE.scoopRate * dt);
      if (Math.random() < dt * 20) {
        this.particles.spawn({ x: f.pos.x, y: 1, z: f.pos.z }, { x: 0, y: 3, z: 0 }, 2, 0x9fd4e8, 0.7, 4);
      }
      if (m.water >= 1 && !wasFull) {
        this.hud.showToast('Tank full — go douse a fire!', 2200);
      }
    }
  }

  dropWater() {
    const f = this.flight;
    const m = this.mission;
    m.water -= SCORE.waterDropCost;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(2.6, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0x3fa7e8, transparent: true, opacity: 0.85 }),
    );
    const load = {
      pos: { x: f.pos.x, y: f.pos.y - 2, z: f.pos.z },
      vel: { x: f.vel.x * 0.9, y: -1, z: f.vel.z * 0.9 },
      mesh,
    };
    mesh.position.copy(load.pos);
    this.scene.add(mesh);
    this.waterDrops.push(load);
    this.sound.dropThump();
    this.hud.showToast('Water away!', 1200);
  }

  updateWaterDrops(dt) {
    const m = this.mission;
    for (let i = this.waterDrops.length - 1; i >= 0; i--) {
      const w = this.waterDrops[i];
      w.vel.y -= 9.81 * dt * 0.55; // same drag as a crate under its chute
      w.vel.y = Math.max(w.vel.y, -16);
      w.pos.x += w.vel.x * dt;
      w.pos.y += w.vel.y * dt;
      w.pos.z += w.vel.z * dt;
      w.mesh.position.copy(w.pos);
      const ground = this.terrain.heightAt(w.pos.x, w.pos.z);
      if (w.pos.y <= ground + 1.2) {
        // Score against the nearest fire still burning.
        let best = null;
        let bestIdx = -1;
        let bestD = Infinity;
        const fires = this.terrain.fires || [];
        for (let j = 0; j < fires.length; j++) {
          if (fires[j].done) continue;
          const d = Math.hypot(w.pos.x - fires[j].def.x, w.pos.z - fires[j].def.z);
          if (d < bestD) { bestD = d; best = fires[j]; bestIdx = j; }
        }
        if (best) {
          const res = m.waterDropped(w, best, bestIdx);
          this.hud.showToast(res.pts > 0 ? `Fire doused! +${res.pts} (${res.d}m off)` : 'Water missed the fires', 2000);
          if (res.pts > 0) this.sound.ringChime(2);
          this.particles.spawn(w.pos, { x: 0, y: 2, z: 0 }, 22, 0x3fa7e8, 1.0, 8);
        }
        this.scene.remove(w.mesh);
        this.waterDrops.splice(i, 1);
      }
    }
  }

  explode(pos) {
    this.particles.spawn(pos, { x: 0, y: 6, z: 0 }, 70, 0xff6a22, 1.6, 8);
    this.particles.spawn(pos, { x: 0, y: 3, z: 0 }, 40, 0x333333, 2.4, 10);
    this.particles.spawn(pos, { x: 0, y: 2, z: 0 }, 30, 0xffc233, 1.0, 6);
  }

  splash(pos) {
    this.particles.spawn(pos, { x: 0, y: 8, z: 0 }, 60, 0x9fd4e8, 1.4, 8);
    this.particles.spawn(pos, { x: 0, y: 4, z: 0 }, 30, 0xffffff, 1.0, 6);
  }

  finishMission() {
    const m = this.mission;
    m.finish();
    this.campaign.recordMission(m);
    this.sound.fanfare();
    this.sound.engineOff();
    this.screen = 'debrief';
    this.showDebrief();
  }

  endCrash(reason) {
    const m = this.mission;
    m.crash(reason);
    this.campaign.recordMission(m);
    this.sound.crash();
    this.sound.engineOff();
    this.screen = 'crashed';
    this.showCrash(reason);
  }

  showDebrief() {
    const m = this.mission;
    const def = this.missionDef;
    this.show('screen-debrief');
    $('debrief-title').textContent = `${def.name} — complete!`;
    $('debrief-stars').textContent = '★'.repeat(m.stars) + '☆'.repeat(3 - m.stars);
    const rows = m.scoreLog.map(
      (s) => `<tr><td>${s.reason}</td><td class="${s.points < 0 ? 'neg' : ''}">${s.points >= 0 ? '+' : ''}${s.points}</td></tr>`,
    ).join('');
    $('debrief-table').innerHTML = `<table>${rows}`
      + `<tr class="total"><td>Total</td><td>${m.score}</td></tr></table>`
      + `<p>Time ${Math.floor(m.elapsed / 60)}:${String(Math.floor(m.elapsed % 60)).padStart(2, '0')} (par ${Math.floor(def.parTime / 60)}:${String(def.parTime % 60).padStart(2, '0')}) · Rings ${m.ringsPassed}/${def.rings.length}${def.fires ? ` · Fires doused ${m.firesDone}/${def.fires.length}` : ''} · Best combo x${m.bestCombo} · Damage ${Math.round(m.damage)}% · Fuel left ${Math.round(m.fuel)} L</p>`
      + `<p>Credits earned: ${def.reward} · Campaign total: ${this.campaign.data.credits} credits, ${this.campaign.totalStars()}★</p>`;
  }

  showCrash(reason) {
    const m = this.mission;
    this.show('screen-crash');
    $('crash-title').textContent = 'Crashed!';
    $('crash-text').textContent = `The ${this.aircraftSpec.name} went down — ${reason}. Score kept so far: ${m.score}. The islands are patient; the plane is not. Try again.`;
  }

  showHelp() {
    this.screen = 'help';
    this.show('screen-help');
  }

  // -- Rendering --------------------------------------------------------------
  updatePlaneMesh(dt) {
    const f = this.flight;
    this.plane.group.position.set(f.pos.x, f.pos.y, f.pos.z);
    this.plane.group.rotation.order = 'YXZ';
    this.plane.group.rotation.y = -f.heading;
    this.plane.group.rotation.x = f.pitch;
    this.plane.group.rotation.z = -f.roll;
    this.plane.update(dt, f.engineOut ? 0 : f.throttle, this.time);
    this.plane.setGearDown(f.gearDown);
  }

  updateCamera(dt) {
    const f = this.flight;
    const cam = this.camera;
    if (this.cameraMode === 'cockpit') {
      // Cabin viewpoint: over the nose, instruments on the HUD.
      const fwd = new THREE.Vector3(Math.sin(f.heading), 0, -Math.cos(f.heading));
      const pos = new THREE.Vector3(f.pos.x, f.pos.y + 1.1, f.pos.z)
        .addScaledVector(fwd, -1.0);
      cam.position.lerp(pos, Math.min(1, dt * 14));
      const look = new THREE.Vector3(f.pos.x, f.pos.y + Math.sin(f.pitch) * 30, f.pos.z)
        .addScaledVector(fwd, 60);
      cam.lookAt(look);
      cam.up.set(0, 1, 0);
      return;
    }
    // Chase camera: behind and above, eased so it never fights the pilot.
    const fwd = new THREE.Vector3(
      Math.sin(f.heading) * Math.cos(f.pitch),
      Math.sin(f.pitch),
      -Math.cos(f.heading) * Math.cos(f.pitch),
    );
    const right = new THREE.Vector3(Math.cos(f.heading), 0, Math.sin(f.heading));
    const desired = new THREE.Vector3(f.pos.x, f.pos.y, f.pos.z)
      .addScaledVector(fwd, -13)
      .addScaledVector(right, -Math.sin(f.roll) * 3)
      .add(new THREE.Vector3(0, 4.6, 0));
    const k = Math.min(1, dt * 5);
    cam.position.lerp(desired, k);
    const look = new THREE.Vector3(f.pos.x, f.pos.y + 1, f.pos.z).addScaledVector(fwd, 26);
    cam.lookAt(look);
  }

  // -- Screenshot poses --------------------------------------------------------
  // Deterministic staged shots for screenshots/: ?shot=cover|runway|night|storm
  applyShot(name) {
    this.shotMode = name;
    const defs = {
      cover: { mission: 6, alt: 130, speed: 50, heading: 0, fireAhead: true },
      runway: { mission: 0, alt: 38, speed: 34, heading: 90, approach: 'ember-field', approachDist: 480 },
      night: { mission: 5, alt: 300, speed: 52, heading: 250, ringsAhead: true, dist: 480 },
      storm: { mission: 3, alt: 210, speed: 44, heading: 190, ringsAhead: true },
    };
    const shot = defs[name] || defs.cover;
    const def = MISSIONS[shot.mission];
    this.loadMission(def, aircraftById(def.aircraft));
    const f = this.flight;
    // Put the plane mid-air at the staged spot, engines running.
    if (shot.approach) {
      const rw = runwayById(shot.approach);
      const rad = (rw.heading * Math.PI) / 180;
      const dist = shot.approachDist || 900;
      // Staged on the extended centreline before the threshold:
      // rw - dir*dist with dir = (sin h, -cos h).
      f.pos.x = rw.x - Math.sin(rad) * dist;
      f.pos.z = rw.z + Math.cos(rad) * dist;
      f.pos.y = rw.altitude + shot.alt;
      f.heading = rad;
      f.onGround = false;
      f.gearDown = true;
      f.throttle = 0.45;
      f.airspeed = shot.speed;
      f.vel = {
        x: Math.sin(f.heading) * shot.speed,
        y: -1.5,
        z: -Math.cos(f.heading) * shot.speed,
      };
    } else if (shot.fireAhead && def.fires && def.fires.length > 0) {
      // Water-bombing run: full tank, gear up, descending on the first fire.
      const fire = def.fires[0];
      const fy = this.terrain.heightAt(fire.x, fire.z);
      const dx = fire.x - def.scoopPoint.x;
      const dz = fire.z - def.scoopPoint.z;
      const len = Math.hypot(dx, dz) || 1;
      f.pos.x = fire.x - (dx / len) * 420;
      f.pos.z = fire.z - (dz / len) * 420;
      f.pos.y = fy + shot.alt;
      f.heading = Math.atan2(dx, -dz);
      f.onGround = false;
      f.gearDown = false;
      f.throttle = 0.6;
      f.airspeed = shot.speed;
      f.vel = {
        x: Math.sin(f.heading) * shot.speed,
        y: -2,
        z: -Math.cos(f.heading) * shot.speed,
      };
      this.mission.water = 1;
    } else if (shot.ringsAhead && def.rings.length > 0) {
      const r = def.rings[0];
      const r2 = def.rings[1] || def.rings[0];
      const dx = r2.x - r.x;
      const dz = r2.z - r.z;
      const len = Math.hypot(dx, dz) || 1;
      // The night shot at 260 m put a neighbouring ring right beside
      // the camera, a giant yellow disc filling half the frame.
      const back = shot.dist || 260;
      f.pos.x = r.x - (dx / len) * back;
      f.pos.z = r.z - (dz / len) * back;
      f.pos.y = r.y + 18;
      f.heading = Math.atan2(dx, -dz);
      f.onGround = false;
      f.gearDown = false;
      f.throttle = 0.72;
      f.airspeed = shot.speed;
      f.vel = {
        x: Math.sin(f.heading) * shot.speed,
        y: 0,
        z: -Math.cos(f.heading) * shot.speed,
      };
    }
    f.pitch = 0.02;
    f.roll = name === 'cover' ? 0.22 : 0.05;
    // Let the world settle, then freeze one frame for the screenshot.
    this.updatePlaneMesh(0);
    this.updateCamera(1);
    this.terrain.update(0.016, f.pos, (def.wind.dir * Math.PI) / 180);
    this.hud.update(0.016, f, this.mission, this.aircraftSpec, 'chase');
    this.renderer.render(this.scene, this.camera);
    if (this.onFirstFrame) this.onFirstFrame();
  }
}
