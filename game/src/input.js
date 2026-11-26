// Emberwing Courier — input. Keyboard and mouse, both live at once:
// arrows / WASD fly the plane, Shift/Ctrl work the throttle, Q/E rudder,
// F flaps, G gear, B brakes, Space drops cargo, C swaps the camera, P
// pauses, M mutes, R restarts, H or ? opens help. Dragging the mouse
// steers pitch and roll; the wheel trims the throttle.

export class Input {
  constructor(canvas) {
    this.keys = {};
    this.mouse = { down: false, dx: 0, dy: 0, x: 0, y: 0 };
    this.pressed = new Set(); // edge-triggered keys, consumed each frame
    this.canvas = canvas;
    this.throttle = 0; // owned here: Shift/Ctrl ramp it, the flight model
    // spools toward it. (An earlier version derived it from the flight
    // model's own spool each frame, which double-lagged: holding Shift
    // for 5 s only reached 8% throttle. This value is the target.)
    this.attach();
  }

  attach() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      this.pressed.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
    window.addEventListener('blur', () => {
      // Clear in place so any held reference to this.keys stays valid.
      for (const k of Object.keys(this.keys)) this.keys[k] = false;
      this.mouse.down = false;
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      this.mouse.down = true;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.mouse.down) return;
      this.mouse.dx += e.clientX - this.mouse.x;
      this.mouse.dy += e.clientY - this.mouse.y;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });
    const up = () => {
      this.mouse.down = false;
    };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.wheelDelta = (this.wheelDelta || 0) + (e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
  }

  down(code) {
    return !!this.keys[code];
  }

  // True once, on the frame the key went down.
  wasPressed(code) {
    return this.pressed.has(code);
  }

  // Read the flight controls for this frame. Returns pitch/roll/yaw in
  // -1..1, throttle as an absolute target 0..1, and edge flags.
  readFlight(dt, currentThrottle) {
    let pitch = 0;
    let roll = 0;
    let yaw = 0;
    if (this.down('ArrowUp') || this.down('KeyW')) pitch += 1;
    if (this.down('ArrowDown') || this.down('KeyS')) pitch -= 1;
    if (this.down('ArrowLeft') || this.down('KeyA')) roll -= 1;
    if (this.down('ArrowRight') || this.down('KeyD')) roll += 1;
    if (this.down('KeyQ')) yaw -= 1;
    if (this.down('KeyE')) yaw += 1;

    // Mouse drag steers: drag up climbs, drag right banks right.
    if (this.mouse.down) {
      pitch += Math.max(-1, Math.min(1, -this.mouse.dy / 120));
      roll += Math.max(-1, Math.min(1, this.mouse.dx / 120));
      this.mouse.dx *= 0.82;
      this.mouse.dy *= 0.82;
    }

    // Throttle: Shift spools up, Control spools down, wheel trims.
    // This is the target the flight model spools toward; it ramps at
    // 0.55/s so full throttle takes under two seconds of holding Shift.
    if (this.down('ShiftLeft') || this.down('ShiftRight')) this.throttle += dt * 0.55;
    if (this.down('ControlLeft') || this.down('ControlRight')) this.throttle -= dt * 0.55;
    if (this.wheelDelta) {
      this.throttle += this.wheelDelta * 0.06;
      this.wheelDelta = 0;
    }
    this.throttle = Math.max(0, Math.min(1, this.throttle));

    return {
      pitch: Math.max(-1, Math.min(1, pitch)),
      roll: Math.max(-1, Math.min(1, roll)),
      yaw,
      throttle: this.throttle,
      flaps: this.down('KeyF'),
      brakes: this.down('KeyB'),
      drop: this.wasPressed('Space'),
      gear: this.wasPressed('KeyG'),
    };
  }

  endFrame() {
    this.pressed.clear();
  }
}
