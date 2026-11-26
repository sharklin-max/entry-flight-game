// Emberwing Courier — the aircraft. Each plane is built from primitives
// (fuselage, wings, tail, propeller, gear, lights) so it looks built, not
// drawn, and reads from the chase camera and in the screenshots.

import * as THREE from '../vendor/three.module.min.js';

export class AircraftMesh {
  constructor(spec) {
    this.spec = spec;
    this.group = new THREE.Group();
    this.prop = null;
    this.gear = [];
    this.navLights = {};
    this.landingLight = null;
    this.build();
  }

  build() {
    const body = new THREE.MeshStandardMaterial({
      color: this.spec.colour, roughness: 0.45, metalness: 0.25,
    });
    const accent = new THREE.MeshStandardMaterial({
      color: this.spec.accent, roughness: 0.5, metalness: 0.15,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0x22242a, roughness: 0.6, metalness: 0.3,
    });
    const glass = new THREE.MeshStandardMaterial({
      color: 0x9fd4e8, roughness: 0.1, metalness: 0.6,
    });

    // Fuselage: a tapered cylinder along -z (nose points -z in local space).
    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.55, 6.4, 12), body);
    fuselage.rotation.x = Math.PI / 2;
    fuselage.position.z = 0.4;
    this.group.add(fuselage);
    // Nose cone.
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.6, 12), accent);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -3.4;
    this.group.add(nose);
    // Cabin / windshield.
    const cabin = new THREE.Mesh(new THREE.SphereGeometry(0.95, 12, 10), glass);
    cabin.scale.set(0.9, 0.75, 1.5);
    cabin.position.set(0, 0.55, -0.9);
    this.group.add(cabin);
    // Tail cone.
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.6, 10), body);
    tail.rotation.x = Math.PI / 2;
    tail.position.z = 4.6;
    this.group.add(tail);

    // Main wing (high wing, STOL look) with accent tips.
    const wing = new THREE.Mesh(new THREE.BoxGeometry(11.4, 0.22, 1.9), body);
    wing.position.set(0, 0.85, -0.2);
    this.group.add(wing);
    for (const side of [-1, 1]) {
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.24, 1.9), accent);
      tip.position.set(side * 5.3, 0.85, -0.2);
      this.group.add(tip);
      // Wing struts: short, tucked between wing and fuselage.
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.7, 6), dark);
      strut.position.set(side * 2.4, 0.05, -0.2);
      strut.rotation.z = side * 0.42;
      this.group.add(strut);
    }
    // Horizontal stabiliser + vertical fin.
    const stab = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.16, 1.1), body);
    stab.position.set(0, 0.35, 5.4);
    this.group.add(stab);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.7, 1.6), accent);
    fin.position.set(0, 1.0, 5.4);
    this.group.add(fin);

    // Propeller: hub + two blades, spins in update().
    this.prop = new THREE.Group();
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.5, 10), dark);
    hub.rotation.x = Math.PI / 2;
    this.prop.add(hub);
    const bladeGeo = new THREE.BoxGeometry(0.34, 2.6, 0.1);
    for (const a of [0, Math.PI]) {
      const blade = new THREE.Mesh(bladeGeo, dark);
      blade.rotation.z = a;
      blade.position.y = 0;
      this.prop.add(blade);
    }
    this.prop.position.set(0, 0, -4.3);
    this.group.add(this.prop);
    // Spinner.
    const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 10), accent);
    spinner.rotation.x = -Math.PI / 2;
    spinner.position.z = -4.55;
    this.group.add(spinner);

    // Landing gear: two mains + tail wheel.
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 6), dark);
      leg.position.set(side * 1.1, -0.9, -0.6);
      this.group.add(leg);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12), dark);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * 1.1, -1.45, -0.6);
      this.group.add(wheel);
      this.gear.push(leg, wheel);
    }
    const tailWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.18, 10), dark);
    tailWheel.rotation.z = Math.PI / 2;
    tailWheel.position.set(0, -0.7, 5.2);
    this.group.add(tailWheel);
    this.gear.push(tailWheel);

    // Navigation lights: red left, green right, white tail strobe.
    const mkLight = (color, x, y, z) => {
      const l = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 8, 8),
        new THREE.MeshBasicMaterial({ color }),
      );
      l.position.set(x, y, z);
      this.group.add(l);
      const point = new THREE.PointLight(color, 4, 30, 2);
      point.position.set(x, y, z);
      this.group.add(point);
      return { mesh: l, light: point };
    };
    this.navLights.left = mkLight(0xff2a2a, -5.7, 0.85, -0.2);
    this.navLights.right = mkLight(0x2aff5a, 5.7, 0.85, -0.2);
    this.navLights.tail = mkLight(0xffffff, 0, 0.6, 5.9);

    // Landing light: a spotlight from the nose, switched on at night / dusk.
    this.landingLight = new THREE.SpotLight(0xfff2c0, 0, 420, 0.42, 0.5, 1.2);
    this.landingLight.position.set(0, -0.4, -3.6);
    const target = new THREE.Object3D();
    target.position.set(0, -6, -60);
    this.group.add(target);
    this.landingLight.target = target;
    this.group.add(this.landingLight);
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xfff6d8 }),
    );
    lamp.position.set(0, -0.4, -4.1);
    this.group.add(lamp);
    this.lampMesh = lamp;
  }

  setGearDown(down) {
    for (const part of this.gear) part.visible = down;
  }

  setLandingLight(on) {
    this.landingLight.intensity = on ? 260 : 0;
    this.lampMesh.material.color.setHex(on ? 0xfff6d8 : 0x555550);
  }

  // Strobe blink + propeller spin. rpm 0..1.
  update(dt, rpm, time) {
    if (this.prop) this.prop.rotation.z += dt * (4 + rpm * 46);
    // Tail strobe double-blinks every ~1.2 s.
    const phase = time % 1.2;
    const on = phase < 0.08 || (phase > 0.18 && phase < 0.26);
    this.navLights.tail.light.intensity = on ? 6 : 0.4;
    this.navLights.tail.mesh.material.color.setHex(on ? 0xffffff : 0x888888);
  }
}
