// Emberwing Courier — flight model. Arcade, but honest: lift grows with
// speed squared, below stall speed the wing quits, bank turns the nose,
// drag and gravity always apply, and wind gusts push the airframe around.
// Landings are judged on vertical speed, centreline and gear state.

import { WORLD } from './config.js';

export class FlightState {
  constructor() {
    this.reset();
  }

  reset() {
    // Position (m), velocity (m/s), attitude (radians).
    this.pos = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.heading = 0; // radians, 0 = north (-z), + clockwise
    this.pitch = 0; // nose up +
    this.roll = 0; // right wing down +
    this.throttle = 0; // 0..1
    this.airspeed = 0;
    this.verticalSpeed = 0;
    this.gearDown = true;
    this.flaps = false;
    this.brakes = false;
    this.onGround = true;
    this.stalled = false;
    this.gForce = 1;
    this.engineOut = false;
  }

  // Place the plane on a runway, facing down it, ready to roll.
  placeOnRunway(runway) {
    const rad = (runway.heading * Math.PI) / 180;
    this.heading = rad;
    this.pitch = 0;
    this.roll = 0;
    this.pos.x = runway.x - Math.sin(rad) * (runway.length / 2 - 40);
    // Behind the threshold: the runway direction is (sin h, -cos h),
    // so the start is rw - dir*(L/2-40), i.e. z = rw.z + cos(h)*d.
    // The old minus put the plane 431 m too far north on North Strip
    // (near the far end, with no runway left to take off from).
    this.pos.z = runway.z + Math.cos(rad) * (runway.length / 2 - 40);
    this.pos.y = runway.altitude + 1.6;
    this.vel = { x: 0, y: 0, z: 0 };
    this.throttle = 0;
    this.airspeed = 0;
    this.onGround = true;
    this.gearDown = true;
    this.flaps = false;
    this.brakes = false;
    this.engineOut = false;
  }

  // One fixed step. inputs: {pitch, roll, throttle, yaw} in -1..1 (throttle
  // is a target 0..1), dt seconds, spec the aircraft, wind {speed, dir},
  // gust 0..1 storm factor, groundHeight(x, z) function.
  step(inputs, dt, spec, wind, gust, groundHeight) {
    // Throttle spool.
    const target = this.engineOut ? 0 : Math.max(0, Math.min(1, inputs.throttle));
    this.throttle += (target - this.throttle) * Math.min(1, dt * 1.6);
    this.flaps = !!inputs.flaps;
    this.brakes = !!inputs.brakes;

    // Control authority fades at low speed; flaps add lift and drag.
    const speedFactor = Math.min(1, this.airspeed / 30);
    const authority = (0.25 + 0.75 * speedFactor) * spec.handling;
    const pitchRate = 0.55 * authority;
    const rollRate = 1.5 * authority;

    if (this.onGround) {
      // On the ground: the runway holds the pitch — until the pilot has
      // enough speed to rotate the nose up for takeoff.
      if (this.airspeed > spec.stallSpeed * 0.85 && inputs.pitch > 0) {
        this.pitch += inputs.pitch * pitchRate * dt * 0.6;
        this.pitch = Math.min(0.22, this.pitch);
      } else {
        this.pitch += (0 - this.pitch) * Math.min(1, dt * 4);
      }
      this.roll += (0 - this.roll) * Math.min(1, dt * 4);
      this.heading += inputs.roll * 0.35 * dt * Math.min(1, this.airspeed / 12);
    } else {
      this.pitch += inputs.pitch * pitchRate * dt;
      this.roll += inputs.roll * rollRate * dt;
      // Roll naturally returns toward level when the stick is centred.
      if (Math.abs(inputs.roll) < 0.05) {
        this.roll += (0 - this.roll) * Math.min(1, dt * 0.5);
      }
      // Bank turns the heading at the coordinated rate: the nose and
      // the flight path turn together (rate = g * tan(roll) / airspeed),
      // so the plane flies where it points. The old law
      // (sin(roll) * turnRate) turned the nose about twice as fast as
      // the banked lift could turn the flight path, so the plane
      // skidded: the velocity lagged the heading by tens of degrees
      // and no line-up on a ring ever converged. `handling` keeps the
      // aircraft character (Albatross turns tighter, Condor wider).
      // Control authority still fades at low speed.
      const turn = (WORLD.gravity * Math.tan(this.roll) / Math.max(12, this.airspeed))
        * spec.handling * (0.4 + 0.6 * speedFactor);
      this.heading += turn * dt + inputs.yaw * 0.12 * dt;
      // Pitch bleeds off in a steep bank unless the pilot pulls.
      if (Math.abs(this.roll) > 0.9) this.pitch -= dt * 0.06;
    }
    this.pitch = Math.max(-0.6, Math.min(0.6, this.pitch));
    this.roll = Math.max(-1.25, Math.min(1.25, this.roll));

    // --- Aerodynamics -----------------------------------------------------
    // Heading h is clockwise from north (-z): nose = (sin h, sin p, -cos h).
    const forward = {
      x: Math.sin(this.heading) * Math.cos(this.pitch),
      y: Math.sin(this.pitch),
      z: -Math.cos(this.heading) * Math.cos(this.pitch),
    };
    // Angle of attack: pitch minus the flight-path angle. This is what the
    // wing actually feels, and it self-limits: as the plane climbs, the
    // flight path rises, AoA shrinks, and lift stops exploding.
    const q = 0.5 * WORLD.airDensity * this.airspeed * this.airspeed;
    const wingArea = 16;
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    const gamma = Math.atan2(this.vel.y, Math.max(1, hSpeed));
    let aoa = this.pitch - gamma;
    aoa = Math.max(-0.15, Math.min(0.35, aoa));
    const clMax = this.flaps ? 1.9 : 1.6;
    let cl = Math.min(clMax, 0.25 + aoa * 4.5);
    cl = Math.max(0, cl);
    this.stalled = !this.onGround
      && (this.airspeed < spec.stallSpeed || aoa > 0.32);
    if (aoa > 0.32) cl *= 0.5; // stalled wing loses half its lift
    const lift = q * wingArea * cl;
    const weight = 980 * WORLD.gravity; // ~980 kg loaded
    const dragCoeff = 0.045 + (this.flaps ? 0.05 : 0) + (this.gearDown ? 0.02 : 0)
      + (this.brakes && this.onGround ? 0.25 : 0) + cl * cl * 0.05;
    const drag = q * wingArea * dragCoeff;
    // Thrust sized so level flight at full throttle settles near topSpeed:
    // thrust_max = drag at topSpeed with a typical drag coefficient.
    const thrust = this.throttle * 0.588 * spec.topSpeed * spec.topSpeed;
    const liftFactor = this.stalled ? 0.35 : 1;

    // Accelerations in world space (forces divided by the 980 kg mass).
    // Drag opposes the velocity vector.
    const mass = 980;
    // Banked lift turns the flight path: the lift vector tilts with the
    // roll, so part of it pulls the velocity sideways toward the turn
    // (right wing down = lift tilts right = the nose and the path turn
    // right together). Without this the nose turned but the velocity
    // barely followed — the plane skidded through turns, the flight
    // path lagging the heading by tens of degrees, and no line-up on a
    // ring ever converged.
    const liftSide = lift * liftFactor * Math.sin(this.roll);
    const ax = (forward.x * thrust - (this.vel.x / Math.max(1, this.airspeed)) * drag + liftSide * Math.cos(this.heading)) / mass;
    const ay = -WORLD.gravity + (lift * liftFactor * Math.cos(this.roll)) / mass
      + (forward.y * thrust) / mass;
    const az = (forward.z * thrust - (this.vel.z / Math.max(1, this.airspeed)) * drag + liftSide * Math.sin(this.heading)) / mass;
    // Wind: blows toward compass direction wind.dir; gusts shove sideways.
    const gustNow = (Math.random() - 0.5) * 2 * gust * 6;
    const windRad = (wind.dir * Math.PI) / 180;
    const windAx = Math.sin(windRad) * wind.speed * 0.12 + Math.cos(windRad) * gustNow * 0.12;
    const windAz = -Math.cos(windRad) * wind.speed * 0.12 + Math.sin(windRad) * gustNow * 0.12;

    this.vel.x += (ax + windAx) * dt;
    this.vel.y += ay * dt;
    this.vel.z += (az + windAz) * dt;

    // Ground handling: rolling friction + brakes, and the runway holds y.
    const ground = groundHeight(this.pos.x, this.pos.z);
    const gearHeight = 1.6;
    if (this.onGround) {
      // Rolling resistance: a small constant deceleration (0.35 m/s^2),
      // brakes 5.5 m/s^2 — not a proportional decay, which would cap the
      // takeoff roll far below rotation speed.
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (hs > 0.1) {
        const decel = this.brakes ? 5.5 : 0.35;
        const ns = Math.max(0, hs - decel * dt);
        this.vel.x *= ns / hs;
        this.vel.z *= ns / hs;
      }
      this.vel.y = 0;
      this.pos.y = ground + gearHeight;
      // Rotate to take off: enough lift and a pulled nose.
      const liftOff = lift * liftFactor > weight * 0.98 && this.pitch > 0.08
        && this.airspeed > spec.stallSpeed * 0.95;
      if (liftOff) {
        this.onGround = false;
        this.pos.y += 0.4;
      }
    }

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    this.airspeed = Math.sqrt(
      this.vel.x * this.vel.x + this.vel.y * this.vel.y + this.vel.z * this.vel.z,
    );
    this.verticalSpeed = this.vel.y;
    this.gForce = Math.max(0.2, (lift * liftFactor) / weight);

    // --- Ground contact while airborne ------------------------------------
    if (!this.onGround) {
      const groundNow = groundHeight(this.pos.x, this.pos.z);
      if (this.pos.y <= groundNow + gearHeight) {
        return this.touchdown(groundNow, gearHeight);
      }
    }
    return null; // no ground event
  }

  // Returns an event object when the wheels (or belly) meet the ground.
  touchdown(ground, gearHeight) {
    const vs = -this.verticalSpeed; // positive = descending
    const onRunway = this.currentRunway; // set by game.js each frame
    const gearOk = this.gearDown;
    this.pos.y = ground + gearHeight;
    const hard = vs > 4.5;
    const crashSpeed = vs > 9 || this.airspeed > 75;
    const belly = !gearOk && vs > 1.5;
    if (crashSpeed || belly) {
      this.vel = { x: 0, y: 0, z: 0 };
      return { type: 'crash', vs, reason: belly ? 'belly landing' : 'impact' };
    }
    // A survivable touchdown: kill the sink, keep rolling.
    this.vel.y = 0;
    this.onGround = true;
    this.pitch = 0;
    this.roll *= 0.4;
    if (hard) {
      return { type: 'hard-landing', vs, onRunway: !!onRunway };
    }
    return { type: 'landing', vs, onRunway: !!onRunway };
  }
}

// Heading in degrees, 0 = north, clockwise (compass convention). The
// physics heading is already clockwise from north, so this is a plain
// radians-to-degrees conversion — no sign flip.
export function headingDeg(headingRad) {
  const d = (headingRad * 180) / Math.PI;
  return ((d % 360) + 360) % 360;
}

// Distance in the horizontal plane.
export function flatDistance(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}
