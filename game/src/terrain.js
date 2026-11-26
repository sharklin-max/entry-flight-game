// Emberwing Courier — terrain and world dressing. All art is procedural:
// a seeded heightfield for the four islands, canvas-painted textures for
// runways and the sea, instanced trees and houses, drifting clouds, a
// smoking volcano and glowing target rings. Nothing is loaded from the net.

import * as THREE from '../vendor/three.module.min.js';
import { WORLD, ISLANDS, RUNWAYS, TIME_OF_DAY, WEATHER } from './config.js';

// Deterministic PRNG (mulberry32) so every screenshot renders the same world.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth value noise over a seeded grid.
function makeNoise(rng) {
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const fade = (t) => t * t * (3 - 2 * t);
  const grad = (h, x, z) => {
    const u = h < 128 ? x : -x;
    const v = h < 64 ? z : h < 192 ? -z : h < 256 ? x : -x;
    return (h & 1 ? u : -u) + (h & 2 ? v : -v);
  };
  return function noise2(x, z) {
    const xi = Math.floor(x) & 255;
    const zi = Math.floor(z) & 255;
    const xf = x - Math.floor(x);
    const zf = z - Math.floor(z);
    const u = fade(xf);
    const v = fade(zf);
    const aa = grad(perm[perm[xi] + zi], xf, zf);
    const ba = grad(perm[perm[xi + 1] + zi], xf - 1, zf);
    const ab = grad(perm[perm[xi] + zi + 1], xf, zf - 1);
    const bb = grad(perm[perm[xi + 1] + zi + 1], xf - 1, zf - 1);
    const x1 = aa + (ba - aa) * u;
    const x2 = ab + (bb - ab) * u;
    return (x1 + (x2 - x1) * v) * 0.7;
  };
}

export class Terrain {
  constructor(scene, rng) {
    this.scene = scene;
    this.rng = rng;
    this.noise = makeNoise(rng);
    this.rings = [];
    this.clouds = [];
    this.rain = null;
    this.smoke = [];
    this.lavaLight = null;
    this.runwayLights = [];
    this.time = 0;
  }

  // Height of the ground at world (x, z). Ocean floor is below sea level.
  heightAt(x, z) {
    let h = -14; // sea bed
    for (const isle of ISLANDS) {
      const dx = x - isle.x;
      const dz = z - isle.z;
      const d = Math.sqrt(dx * dx + dz * dz) / isle.radius;
      if (d >= 1.35) continue;
      const fall = Math.max(0, 1 - d * d);
      const bump = fall * fall * isle.peak;
      const detail = this.noise(x * 0.004, z * 0.004) * 14 * fall
        + this.noise(x * 0.02 + 40, z * 0.02 + 40) * 3.5 * fall;
      let islandH = bump + detail;
      if (isle.volcano) {
        // Steep cone near the centre, crater dip at the very top.
        const dc = Math.sqrt((x - isle.x) * (x - isle.x) + (z - (isle.z - 250)) * (z - (isle.z - 250))) / 420;
        const cone = Math.max(0, 1 - dc) * 190;
        islandH = Math.max(islandH, cone - 40);
        if (dc < 0.12) islandH -= 26; // crater
      }
      h = Math.max(h, islandH);
    }
    // Flatten the ground under each runway so strips sit level. The strip
    // itself is fully flat (weight 1 across its whole length and width);
    // only the 60 m apron around it blends back to natural terrain.
    // (An earlier linear fade left the strip sloping at its ends: the
    // plane spawned 20 m above the ground at the runway threshold and
    // fell onto it, turning the nose while it dropped.)
    for (const rw of RUNWAYS) {
      const rad = (rw.heading * Math.PI) / 180;
      const dx = x - rw.x;
      const dz = z - rw.z;
      // Local frame: the runway direction is (sin h, -cos h) in (x, z)
      // because north is -z. The old signs rotated the flattened
      // rectangle by twice the heading, so the flat ground sat 20 deg
      // off the visual strip on North Strip (and the same bug in
      // runwayUnder rejected on-strip landings).
      const along = dx * Math.sin(rad) - dz * Math.cos(rad);
      const across = dx * Math.cos(rad) + dz * Math.sin(rad);
      if (Math.abs(along) < rw.length / 2 + 60 && Math.abs(across) < rw.width / 2 + 60) {
        const base = this.rawHeightAt(rw.x, rw.z);
        const alongW = Math.abs(along) <= rw.length / 2
          ? 1
          : Math.max(0, 1 - (Math.abs(along) - rw.length / 2) / 60);
        const acrossW = Math.abs(across) <= rw.width / 2
          ? 1
          : Math.max(0, 1 - (Math.abs(across) - rw.width / 2) / 60);
        const w = alongW * acrossW;
        h = h * (1 - w) + base * w;
      }
    }
    return h;
  }

  // Height without runway flattening (used to pick the strip altitude).
  rawHeightAt(x, z) {
    let h = -14;
    for (const isle of ISLANDS) {
      const dx = x - isle.x;
      const dz = z - isle.z;
      const d = Math.sqrt(dx * dx + dz * dz) / isle.radius;
      if (d >= 1.35) continue;
      const fall = Math.max(0, 1 - d * d);
      const bump = fall * fall * isle.peak;
      const detail = this.noise(x * 0.004, z * 0.004) * 14 * fall
        + this.noise(x * 0.02 + 40, z * 0.02 + 40) * 3.5 * fall;
      let islandH = bump + detail;
      if (isle.volcano) {
        const dc = Math.sqrt((x - isle.x) * (x - isle.x) + (z - (isle.z - 250)) * (z - (isle.z - 250))) / 420;
        const cone = Math.max(0, 1 - dc) * 190;
        islandH = Math.max(islandH, cone - 40);
        if (dc < 0.12) islandH -= 26;
      }
      h = Math.max(h, islandH);
    }
    return h;
  }

  build(timeOfDay, weather) {
    const tod = TIME_OF_DAY[timeOfDay] || TIME_OF_DAY.noon;
    const wx = WEATHER[weather] || WEATHER.calm;
    this.buildSky(tod);
    this.buildGround(tod);
    this.buildOcean(tod);
    this.buildRunways(tod);
    this.buildVegetation();
    this.buildVolcano(tod);
    this.buildClouds(wx, tod);
    if (wx.rain > 0) this.buildRain();
    return { tod, wx };
  }

  buildSky(tod) {
    const sky = new THREE.Color(tod.sky);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(new THREE.Color(tod.fog), 400, tod.sun > 0 ? 9000 : 4200);
    const hemi = new THREE.HemisphereLight(tod.sky, 0x3a4a2a, tod.ambient * 1.15);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(tod.sunColor, tod.sun > 0 ? 1.6 : 0.25);
    const elev = Math.max(0.08, tod.sun);
    sun.position.set(Math.cos(0.6) * 1000, elev * 1400, Math.sin(0.6) * 1000);
    this.scene.add(sun);
    this.sun = sun;
    // Sun disc + moon for night flights.
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(60, 24),
      new THREE.MeshBasicMaterial({ color: tod.sun > 0 ? 0xfff3c0 : 0xdfe8ff, fog: false }),
    );
    disc.position.set(Math.cos(0.6) * 4200, Math.max(300, elev * 2600), Math.sin(0.6) * 4200);
    disc.lookAt(0, 0, 0);
    this.scene.add(disc);
  }

  buildGround(tod) {
    const size = WORLD.size;
    const seg = 180;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cSand = new THREE.Color(0xd9c28a);
    const cGrass = new THREE.Color(0x5d8a3c);
    const cForest = new THREE.Color(0x3d6b2e);
    const cRock = new THREE.Color(0x7a6a58);
    const cSnow = new THREE.Color(0xe8eef2);
    const cLava = new THREE.Color(0x8a2a12);
    const cBed = new THREE.Color(0x2a4a5e);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = this.heightAt(x, z);
      pos.setY(i, h);
      if (h < 0.5) tmp.copy(cBed).lerp(cSand, Math.max(0, (h + 14) / 15) * 0.7);
      else if (h < 4) tmp.copy(cSand);
      else if (h < 45) tmp.copy(cGrass).lerp(cForest, this.noise(x * 0.01, z * 0.01) * 0.5 + 0.25);
      else if (h < 130) tmp.copy(cRock).lerp(cGrass, 0.25);
      else if (h < 200) tmp.copy(cRock);
      else tmp.copy(cSnow);
      // Volcano flanks glow dark red near the crater.
      const dv = Math.sqrt(x * x + (z - 50) * (z - 50));
      if (dv < 420 && h > 120) tmp.lerp(cLava, Math.max(0, 1 - dv / 420) * 0.55);
      // Dusk/night dimming.
      tmp.multiplyScalar(0.55 + tod.ambient * 0.55);
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.ground = new THREE.Mesh(geo, mat);
    this.scene.add(this.ground);
  }

  buildOcean(tod) {
    const geo = new THREE.PlaneGeometry(WORLD.size * 1.6, WORLD.size * 1.6, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshPhongMaterial({
      color: tod.sun > 0 ? 0x1e6f9e : 0x0c2438,
      shininess: 120,
      specular: 0x99ccff,
      transparent: true,
      opacity: 0.92,
    });
    this.ocean = new THREE.Mesh(geo, mat);
    this.ocean.position.y = WORLD.seaLevel + 0.4;
    this.scene.add(this.ocean);
  }

  runwayTexture(rw, night) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 1024;
    const g = c.getContext('2d');
    g.fillStyle = rw.surface === 'grass' ? '#6f8146' : rw.surface === 'dirt' ? '#8a6a48' : '#33363b';
    g.fillRect(0, 0, 256, 1024);
    if (rw.surface === 'grass') {
      // Mown bands so a grass strip reads against grass terrain.
      g.fillStyle = '#7d9150';
      for (let y = 0; y < 1024; y += 128) g.fillRect(0, y, 256, 64);
    }
    // Edge lines.
    g.strokeStyle = '#f5f5f5';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(18, 0); g.lineTo(18, 1024);
    g.moveTo(238, 0); g.lineTo(238, 1024);
    g.stroke();
    // Centre dashes.
    g.fillStyle = '#f5f5f5';
    for (let y = 30; y < 1024; y += 90) g.fillRect(124, y, 8, 48);
    // Threshold bars at both ends.
    for (const y0 of [12, 960]) {
      for (let i = 0; i < 4; i++) g.fillRect(36 + i * 52, y0, 34, 52);
    }
    // Runway number (heading/10).
    g.fillStyle = '#f5f5f5';
    g.font = 'bold 92px sans-serif';
    g.textAlign = 'center';
    const num = String(Math.round(((rw.heading % 360) + 360) % 360 / 10)).padStart(2, '0');
    g.fillText(num, 128, 880);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  }

  buildRunways(tod) {
    for (const rw of RUNWAYS) {
      const y = this.rawHeightAt(rw.x, rw.z) + 0.6;
      const tex = this.runwayTexture(rw, tod.sun <= 0);
      const mat = new THREE.MeshLambertMaterial({ map: tex });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(rw.width, rw.length), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = -(rw.heading * Math.PI) / 180;
      mesh.position.set(rw.x, y, rw.z);
      mesh.receiveShadow = false;
      this.scene.add(mesh);
      rw.altitude = y;
      // Edge lights: small glowing spheres, bright at night.
      const lightMat = new THREE.MeshBasicMaterial({
        color: tod.sun <= 0 ? 0xffd76a : 0xffe9a8,
      });
      const group = new THREE.Group();
      const n = Math.floor(rw.length / 60);
      for (let i = 0; i <= n; i++) {
        const along = -rw.length / 2 + (i * rw.length) / n;
        const rad = (rw.heading * Math.PI) / 180;
        for (const side of [-1, 1]) {
          const s = new THREE.Mesh(new THREE.SphereGeometry(1.6, 6, 6), lightMat);
          const across = (rw.width / 2 + 4) * side;
          s.position.set(
            rw.x + along * Math.sin(rad) + across * Math.cos(rad),
            y + 1,
            rw.z - along * Math.cos(rad) + across * Math.sin(rad),
          );
          group.add(s);
        }
      }
      this.scene.add(group);
      this.runwayLights.push(group);
    }
  }

  buildVegetation() {
    const rng = this.rng;
    const trunkGeo = new THREE.CylinderGeometry(1.2, 1.8, 7, 5);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2a });
    const topGeo = new THREE.ConeGeometry(7, 16, 6);
    const topMat = new THREE.MeshLambertMaterial({ color: 0x2f6b2a });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, 320);
    const tops = new THREE.InstancedMesh(topGeo, topMat, 320);
    const m = new THREE.Matrix4();
    let placed = 0;
    let tries = 0;
    while (placed < 320 && tries < 4000) {
      tries++;
      const x = (rng() - 0.5) * WORLD.size * 0.9;
      const z = (rng() - 0.5) * WORLD.size * 0.9;
      const h = this.heightAt(x, z);
      if (h < 6 || h > 90) continue;
      // Keep trees off runways.
      let onStrip = false;
      for (const rw of RUNWAYS) {
        const rad = (rw.heading * Math.PI) / 180;
        const dx = x - rw.x;
        const dz = z - rw.z;
        // Same local-frame fix as the flattening above: (sin h, -cos h).
        const along = dx * Math.sin(rad) - dz * Math.cos(rad);
        const across = dx * Math.cos(rad) + dz * Math.sin(rad);
        if (Math.abs(along) < rw.length / 2 + 40 && Math.abs(across) < rw.width / 2 + 40) onStrip = true;
      }
      if (onStrip) continue;
      const s = 0.8 + rng() * 0.9;
      m.makeScale(s, s, s);
      m.setPosition(x, h + 3 * s, z);
      trunks.setMatrixAt(placed, m);
      m.makeScale(s, s, s);
      m.setPosition(x, h + 12 * s, z);
      tops.setMatrixAt(placed, m);
      placed++;
    }
    trunks.count = placed;
    tops.count = placed;
    this.scene.add(trunks);
    this.scene.add(tops);
    // A handful of houses near Ember Field.
    const houseMat = new THREE.MeshLambertMaterial({ color: 0xe8dcc0 });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0xa03a28 });
    for (let i = 0; i < 9; i++) {
      const x = -420 + rng() * 500;
      const z = 950 + rng() * 260;
      const h = this.heightAt(x, z);
      if (h < 2) continue;
      const house = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(14, 9, 12), houseMat);
      base.position.y = 4.5;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(11, 6, 4), roofMat);
      roof.position.y = 12;
      roof.rotation.y = Math.PI / 4;
      house.add(base);
      house.add(roof);
      house.position.set(x, h, z);
      house.rotation.y = rng() * Math.PI;
      this.scene.add(house);
    }
  }

  buildVolcano(tod) {
    // Lava glow at the crater + a point light so night runs read.
    const crater = new THREE.Mesh(
      new THREE.CircleGeometry(46, 24),
      new THREE.MeshBasicMaterial({ color: 0xff5a1a }),
    );
    crater.rotation.x = -Math.PI / 2;
    const cy = this.heightAt(0, 50) + 1.5;
    crater.position.set(0, cy, 50);
    this.scene.add(crater);
    this.lavaLight = new THREE.PointLight(0xff6a22, tod.sun > 0 ? 60 : 900, 1600, 1.6);
    this.lavaLight.position.set(0, cy + 30, 50);
    this.scene.add(this.lavaLight);
    // Smoke column: rising translucent spheres.
    const smokeMat = new THREE.MeshBasicMaterial({
      color: 0x555555, transparent: true, opacity: 0.22,
    });
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(14 + i * 3, 8, 8), smokeMat);
      s.position.set(0, cy + 20 + i * 26, 50);
      this.scene.add(s);
      this.smoke.push(s);
    }
  }

  buildClouds(wx, tod) {
    const rng = this.rng;
    const count = Math.round(14 + wx.cloudCover * 26);
    const mat = new THREE.MeshLambertMaterial({
      color: wx.rain > 0 ? 0x5a5a60 : 0xffffff,
      transparent: true,
      opacity: wx.rain > 0 ? 0.85 : 0.92,
    });
    for (let i = 0; i < count; i++) {
      const cloud = new THREE.Group();
      const puffs = 3 + Math.floor(rng() * 4);
      for (let j = 0; j < puffs; j++) {
        const r = 26 + rng() * 42;
        const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 10), mat);
        puff.position.set((rng() - 0.5) * 160, (rng() - 0.5) * 14, (rng() - 0.5) * 90);
        puff.scale.y = 0.45;
        cloud.add(puff);
      }
      cloud.position.set(
        (rng() - 0.5) * WORLD.size,
        320 + rng() * 260,
        (rng() - 0.5) * WORLD.size,
      );
      this.scene.add(cloud);
      this.clouds.push(cloud);
    }
  }

  buildRain() {
    const count = 2400;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 900;
      pos[i * 3 + 1] = Math.random() * 320;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 900;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xaec6dd, size: 1.6, transparent: true, opacity: 0.55,
    });
    this.rain = new THREE.Points(geo, mat);
    this.scene.add(this.rain);
  }

  // Target rings for the current mission.
  buildRings(ringDefs) {
    this.clearRings();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffc233, transparent: true, opacity: 0.95,
    });
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0xffe9a8, transparent: true, opacity: 0.35, side: THREE.DoubleSide,
    });
    for (const def of ringDefs) {
      const group = new THREE.Group();
      const torus = new THREE.Mesh(new THREE.TorusGeometry(26, 2.4, 10, 40), mat);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(25, 32), innerMat);
      group.add(torus);
      group.add(disc);
      group.position.set(def.x, def.y, def.z);
      // Face the ring along the course: rings stand upright, facing the
      // direction of travel (set by game.js after the next ring is known).
      this.scene.add(group);
      this.rings.push({ group, torus, disc, def, passed: false, missed: false });
    }
    return this.rings;
  }

  clearRings() {
    for (const r of this.rings) this.scene.remove(r.group);
    this.rings = [];
  }

  // Wildfire markers for the firefighting mission: a glowing cone, a
  // smoke column and a flickering light at each burning spot.
  buildFires(fireDefs) {
    this.clearFires();
    this.fires = [];
    for (const def of fireDefs) {
      const y = this.heightAt(def.x, def.z);
      const group = new THREE.Group();
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(def.r * 0.55, 26, 10),
        new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.9 }),
      );
      cone.position.y = 13;
      group.add(cone);
      const glow = new THREE.Mesh(
        new THREE.CircleGeometry(def.r, 24),
        new THREE.MeshBasicMaterial({ color: 0xff3d00, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 1.2;
      group.add(glow);
      const smokeMat = new THREE.MeshBasicMaterial({ color: 0x3a3a3a, transparent: true, opacity: 0.35 });
      const puffs = [];
      for (let i = 0; i < 4; i++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(9 + i * 3, 8, 8), smokeMat);
        puff.position.set(0, 24 + i * 16, 0);
        group.add(puff);
        puffs.push(puff);
      }
      const light = new THREE.PointLight(0xff6a22, 260, 420, 1.8);
      light.position.y = 24;
      group.add(light);
      group.position.set(def.x, y, def.z);
      this.scene.add(group);
      this.fires.push({ def, group, cone, glow, puffs, light, groundY: y, done: false });
    }
    return this.fires;
  }

  clearFires() {
    if (!this.fires) return;
    for (const f of this.fires) this.scene.remove(f.group);
    this.fires = [];
  }

  // Drop-zone markers: painted circles on the ground.
  buildDropZones(drops) {
    this.clearDropZones();
    this.dropZones = [];
    for (const d of drops) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(d.r * 0.55, d.r, 40),
        new THREE.MeshBasicMaterial({
          color: 0xffc233, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(d.x, this.heightAt(d.x, d.z) + 1.2, d.z);
      const inner = new THREE.Mesh(
        new THREE.CircleGeometry(d.r * 0.55, 32),
        new THREE.MeshBasicMaterial({
          color: 0xffc233, transparent: true, opacity: 0.25, side: THREE.DoubleSide,
        }),
      );
      inner.rotation.x = -Math.PI / 2;
      inner.position.set(d.x, this.heightAt(d.x, d.z) + 1.1, d.z);
      this.scene.add(ring);
      this.scene.add(inner);
      this.dropZones.push({ def: d, ring, inner, done: false });
    }
    return this.dropZones;
  }

  clearDropZones() {
    if (!this.dropZones) return;
    for (const dz of this.dropZones) {
      this.scene.remove(dz.ring);
      this.scene.remove(dz.inner);
    }
    this.dropZones = [];
  }

  update(dt, planePos, windDir) {
    this.time += dt;
    // Clouds drift with the wind.
    for (const c of this.clouds) {
      c.position.x += Math.cos(windDir) * 2.2 * dt;
      c.position.z += Math.sin(windDir) * 2.2 * dt;
      if (c.position.x > WORLD.size / 2 + 400) c.position.x = -WORLD.size / 2 - 400;
      if (c.position.x < -WORLD.size / 2 - 400) c.position.x = WORLD.size / 2 + 400;
      if (c.position.z > WORLD.size / 2 + 400) c.position.z = -WORLD.size / 2 - 400;
      if (c.position.z < -WORLD.size / 2 - 400) c.position.z = WORLD.size / 2 + 400;
    }
    // Smoke rises and sways.
    for (let i = 0; i < this.smoke.length; i++) {
      const s = this.smoke[i];
      s.position.y += dt * 6;
      s.position.x += Math.sin(this.time * 0.5 + i) * dt * 3;
      if (s.position.y > 620) s.position.y = this.heightAt(0, 50) + 20 + i * 4;
    }
    // Lava flicker.
    if (this.lavaLight) {
      this.lavaLight.intensity *= 0.985 + Math.random() * 0.03;
    }
    // Rain follows the plane.
    if (this.rain && planePos) {
      this.rain.position.set(planePos.x, 0, planePos.z);
      const pos = this.rain.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) - dt * 260;
        if (y < 0) y = 320;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
    }
    // Ring pulse: the next ring glows, passed rings dim.
    for (const r of this.rings) {
      const target = r.passed ? 0.15 : r.missed ? 0.2 : 0.95;
      r.torus.material.opacity += (target - r.torus.material.opacity) * dt * 4;
      if (!r.passed && !r.missed) {
        const s = 1 + Math.sin(this.time * 3) * 0.03;
        r.group.scale.set(s, s, s);
      }
    }
    // Wildfires flicker; a doused fire goes dark and stops smoking.
    if (this.fires) {
      for (const f of this.fires) {
        if (f.done) {
          f.cone.visible = false;
          f.glow.visible = false;
          f.light.intensity = 0;
          for (const p of f.puffs) p.visible = false;
          continue;
        }
        const flick = 0.85 + Math.sin(this.time * 7 + f.def.x) * 0.15;
        f.cone.scale.set(flick, 1 + (flick - 0.85) * 0.6, flick);
        f.light.intensity = 260 * flick;
        for (let i = 0; i < f.puffs.length; i++) {
          const p = f.puffs[i];
          p.position.y += dt * 5;
          if (p.position.y > 90) p.position.y = 24;
        }
      }
    }
  }
}
