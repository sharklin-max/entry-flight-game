// Emberwing Courier — HUD. Lit instruments on a glass panel: airspeed and
// altitude tapes, a heading compass, an artificial horizon, fuel and
// damage bars, throttle, timer, score and the target bearing arrow. All
// DOM + one small canvas, updated every frame from the flight state.

import { headingDeg } from './physics.js';

export class Hud {
  constructor(root) {
    this.root = root;
    this.build();
    this.lastAlarm = 0;
  }

  build() {
    const el = (tag, cls, parent, text) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined) n.textContent = text;
      (parent || this.root).appendChild(n);
      return n;
    };
    this.hud = el('div', 'hud');

    // Top-left: speed / altitude / heading readouts.
    const left = el('div', 'hud-left', this.hud);
    this.ias = el('div', 'hud-big', left, '0');
    el('div', 'hud-label', left, 'AIRSPEED KT');
    this.alt = el('div', 'hud-big', left, '0');
    el('div', 'hud-label', left, 'ALTITUDE FT');
    this.hdg = el('div', 'hud-big', left, '000°');
    el('div', 'hud-label', left, 'HEADING');

    // Top-centre: compass strip + objective + timer + score.
    const centre = el('div', 'hud-centre', this.hud);
    this.compass = el('div', 'compass', centre);
    this.compassMarks = [];
    for (let i = 0; i < 25; i++) {
      const m = el('div', 'compass-mark', this.compass);
      this.compassMarks.push(m);
    }
    this.objective = el('div', 'objective', centre, 'Fly!');
    const row = el('div', 'hud-row', centre);
    this.timer = el('div', 'hud-timer', row, '0:00');
    this.score = el('div', 'hud-score', row, 'SCORE 0');
    this.target = el('div', 'hud-target', centre, '');

    // Artificial horizon (canvas) + vertical speed, bottom-left.
    const bl = el('div', 'hud-bl', this.hud);
    this.horizon = el('canvas', 'horizon', bl);
    this.horizon.width = 150;
    this.horizon.height = 150;
    el('div', 'hud-label', bl, 'ATTITUDE');
    this.vs = el('div', 'hud-vs', bl, 'VS +0');
    el('div', 'hud-label', bl, 'VERT SPEED M/S');

    // Bottom-right: throttle, fuel, damage (+ water on the fire mission).
    const br = el('div', 'hud-br', this.hud);
    this.throttleBar = this.bar(br, 'THROTTLE');
    this.fuelBar = this.bar(br, 'FUEL');
    this.damageBar = this.bar(br, 'DAMAGE');
    this.waterBar = this.bar(br, 'WATER');

    // Warnings, centre screen.
    this.warn = el('div', 'hud-warn', this.hud, '');
    // Message toast (ring passed, crate scored...).
    this.toast = el('div', 'hud-toast', this.hud, '');
    this.toastTimer = 0;
  }

  bar(parent, label) {
    const wrap = document.createElement('div');
    wrap.className = 'hud-bar-wrap';
    const lab = document.createElement('div');
    lab.className = 'hud-label';
    lab.textContent = label;
    const track = document.createElement('div');
    track.className = 'hud-bar-track';
    const fill = document.createElement('div');
    fill.className = 'hud-bar-fill';
    track.appendChild(fill);
    const val = document.createElement('div');
    val.className = 'hud-bar-val';
    wrap.appendChild(lab);
    wrap.appendChild(track);
    wrap.appendChild(val);
    parent.appendChild(wrap);
    return { fill, val };
  }

  showToast(text, ms) {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    this.toastTimer = ms || 1800;
  }

  update(dt, flight, mission, aircraftSpec, cameraMode) {
    // Tapes: knots, feet, compass heading.
    const kt = Math.round(flight.airspeed * 1.944);
    const ft = Math.round(flight.pos.y * 3.281);
    this.ias.textContent = String(kt);
    this.alt.textContent = String(ft);
    const hdg = headingDeg(flight.heading);
    this.hdg.textContent = `${String(Math.round(hdg)).padStart(3, '0')}°`;

    // Compass strip: marks every 15 degrees, centred on the heading.
    // Always label something: the nearest cardinal within 7 degrees, else
    // the degree number on alternate marks so the strip never reads blank.
    const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let i = 0; i < 25; i++) {
      const offsetDeg = (i - 12) * 15;
      let deg = Math.round(hdg + offsetDeg);
      deg = ((deg % 360) + 360) % 360;
      const m = this.compassMarks[i];
      const nearestCardinal = Object.keys(labels)
        .map(Number)
        .reduce((best, c) => {
          const d = Math.min(Math.abs(deg - c), 360 - Math.abs(deg - c));
          return d < best.d ? { c, d } : best;
        }, { c: -1, d: 999 });
      let text = '';
      let major = false;
      if (nearestCardinal.d <= 7) {
        text = labels[nearestCardinal.c];
        major = true;
      } else if (i % 2 === 0) {
        text = String(deg);
      }
      m.textContent = text;
      m.classList.toggle('major', major);
      m.style.left = `${4 + i * 4}%`;
    }

    this.objective.textContent = mission ? mission.objectiveText() : '';
    const t = mission ? Math.max(0, mission.def.timeLimit - mission.elapsed) : 0;
    const mm = Math.floor(t / 60);
    const ss = Math.floor(t % 60);
    this.timer.textContent = `${mm}:${String(ss).padStart(2, '0')}`;
    this.timer.classList.toggle('low', t < 60);
    this.score.textContent = `SCORE ${mission ? mission.score : 0}`;

    // Target bearing arrow.
    if (mission && mission.phase === 'flying') {
      const info = mission.targetInfo(flight.pos);
      if (info) {
        let rel = info.bearing - hdg;
        rel = ((rel + 540) % 360) - 180; // -180..180
        const arrow = rel > 45 ? '↗' : rel > 10 ? '→' : rel < -45 ? '↖' : rel < -10 ? '←' : '↑';
        const dir = rel > 10 ? 'R' : rel < -10 ? 'L' : '';
        this.target.textContent = `${arrow} ${info.distance}m ${dir} ${info.bearing}° ${info.altDiff >= 0 ? '+' : ''}${info.altDiff}m`;
      } else {
        this.target.textContent = '';
      }
    } else {
      this.target.textContent = '';
    }

    // Attitude indicator.
    this.drawHorizon(flight);

    const vs = flight.verticalSpeed;
    this.vs.textContent = `VS ${vs >= 0 ? '+' : ''}${vs.toFixed(1)}`;
    this.vs.classList.toggle('sink', vs < -6);

    // Bars.
    this.setBar(this.throttleBar, flight.throttle, `${Math.round(flight.throttle * 100)}%`);
    if (mission) {
      const fuelFrac = mission.fuel / aircraftSpec.fuelLitres;
      this.setBar(this.fuelBar, fuelFrac, `${Math.round(fuelFrac * 100)}%`);
      this.fuelBar.fill.classList.toggle('low', fuelFrac < 0.2);
      this.setBar(this.damageBar, mission.damage / 100, `${Math.round(mission.damage)}%`);
      this.damageBar.fill.classList.toggle('bad', mission.damage > 60);
      // Water tank: only the fire mission carries one.
      const showWater = !!mission.def.fires;
      this.waterBar.fill.parentElement.parentElement.style.display = showWater ? '' : 'none';
      if (showWater) this.setBar(this.waterBar, mission.water, `${Math.round(mission.water * 100)}%`);
    }

    // Warnings.
    const warns = [];
    if (flight.stalled) warns.push('STALL');
    if (mission && mission.fuel / aircraftSpec.fuelLitres < 0.15) warns.push('LOW FUEL');
    if (mission && mission.def.fires && mission.water < 0.33 && mission.firesDone < mission.def.fires.length) warns.push('TANK EMPTY — SCOOP WATER');
    if (flight.onGround && !flight.gearDown) warns.push('GEAR UP');
    if (mission && mission.damage > 70) warns.push('DAMAGE CRITICAL');
    this.warn.textContent = warns.join('  •  ');
    this.warn.classList.toggle('show', warns.length > 0);

    if (this.toastTimer > 0) {
      this.toastTimer -= dt * 1000;
      if (this.toastTimer <= 0) this.toast.classList.remove('show');
    }
  }

  setBar(bar, frac, text) {
    const f = Math.max(0, Math.min(1, frac));
    bar.fill.style.width = `${f * 100}%`;
    bar.val.textContent = text;
  }

  drawHorizon(flight) {
    const c = this.horizon.getContext('2d');
    const w = this.horizon.width;
    const h = this.horizon.height;
    const cx = w / 2;
    const cy = h / 2;
    c.clearRect(0, 0, w, h);
    c.save();
    c.beginPath();
    c.arc(cx, cy, 68, 0, Math.PI * 2);
    c.clip();
    // Sky / ground, rotated by roll, shifted by pitch.
    c.translate(cx, cy);
    c.rotate(-flight.roll);
    const pitchPx = flight.pitch * 90;
    c.translate(0, pitchPx);
    c.fillStyle = '#3a7bd5';
    c.fillRect(-90, -160, 180, 160);
    c.fillStyle = '#7a5a33';
    c.fillRect(-90, 0, 180, 160);
    // Horizon line.
    c.strokeStyle = '#ffffff';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(-90, 0);
    c.lineTo(90, 0);
    c.stroke();
    // Pitch ladder.
    c.fillStyle = '#ffffff';
    c.font = '10px sans-serif';
    c.textAlign = 'center';
    for (const deg of [-20, -10, 10, 20]) {
      const y = -deg * 1.6;
      c.fillRect(-18, y, 36, 1);
      c.fillText(String(Math.abs(deg)), 28, y + 3);
    }
    c.restore();
    // Fixed aircraft symbol.
    c.strokeStyle = '#ffd76a';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(cx - 34, cy);
    c.lineTo(cx - 8, cy);
    c.moveTo(cx + 8, cy);
    c.lineTo(cx + 34, cy);
    c.moveTo(cx, cy);
    c.lineTo(cx, cy + 7);
    c.stroke();
    // Bezel.
    c.strokeStyle = '#1c2733';
    c.lineWidth = 5;
    c.beginPath();
    c.arc(cx, cy, 70, 0, Math.PI * 2);
    c.stroke();
  }
}
