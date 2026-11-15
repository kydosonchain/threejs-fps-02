// Weapons: five guns and a frag grenade. The table owns the numbers; main.js owns the
// ray and the damage. Spread grows with movement, airtime and consecutive shots, and
// shrinks when still and crouched, so stopping to aim pays. The sniper zooms on right click.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: { name: 'P9 Sidearm', price: 0, damage: 34, headMult: 3, pellets: 1, mag: 12, reserve: 36, gap: 0.22, auto: false, reload: 1.4, spreadStill: 0.004, spreadMove: 0.02, recoil: 0.006, speed: 1.0, range: 40 },
  smg: { name: 'RASP SMG', price: 1500, damage: 26, headMult: 3, pellets: 1, mag: 28, reserve: 84, gap: 0.085, auto: true, reload: 1.8, spreadStill: 0.008, spreadMove: 0.034, recoil: 0.005, speed: 1.05, range: 30 },
  rifle: { name: 'VK-7 Rifle', price: 2700, damage: 34, headMult: 4, pellets: 1, mag: 25, reserve: 75, gap: 0.1, auto: true, reload: 2.2, spreadStill: 0.002, spreadMove: 0.028, recoil: 0.011, speed: 1.0, range: 60 },
  sniper: { name: 'LONGBOW DMR', price: 4750, damage: 95, headMult: 4, pellets: 1, mag: 5, reserve: 15, gap: 1.1, auto: false, reload: 2.8, spreadStill: 0.0005, spreadMove: 0.06, recoil: 0.05, speed: 0.92, range: 120, scope: true },
  shotgun: { name: 'BREACHER', price: 1200, damage: 12, headMult: 2, pellets: 8, mag: 6, reserve: 18, gap: 0.9, auto: false, reload: 2.6, spreadStill: 0.03, spreadMove: 0.05, recoil: 0.03, speed: 0.95, range: 18 },
};

export const GRENADE = { name: 'SPARK Frag', price: 300, radius: 6, maxDamage: 120, fuse: 1.6 };

const GRAVITY = 12;
const PROBE = new THREE.Box3();

export function createWeapons(camera, scene, colliders) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.6, metalness: 0.3 });

  const model = new THREE.Group();
  model.position.set(0.24, -0.2, -0.42);
  camera.add(model);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const state = {
    current: 'pistol',
    owned: { pistol: { mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve } },
    grenades: 0,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    bloom: 0,
    bobPhase: 0,
  };
  const grenades = [];
  const explosionMeshes = [];

  function buildModel(id) {
    while (model.children.length) model.remove(model.children[0]);
    const add = (w, h, d, x, y, z, mat) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      model.add(mesh);
      return mesh;
    };
    if (id === 'pistol') {
      add(0.07, 0.1, 0.26, 0, 0, -0.1, body);
      add(0.06, 0.12, 0.08, 0, -0.07, 0.06, grip);
    } else if (id === 'smg') {
      add(0.08, 0.09, 0.4, 0, 0, -0.08, body);
      add(0.04, 0.04, 0.3, 0, 0.02, -0.36, grip);
      add(0.06, 0.14, 0.07, 0, -0.08, 0.02, grip);
    } else if (id === 'rifle') {
      add(0.09, 0.1, 0.42, 0, 0, -0.1, body);
      add(0.045, 0.045, 0.4, 0, 0.025, -0.42, grip);
      add(0.075, 0.08, 0.22, 0, -0.02, 0.18, grip);
      add(0.05, 0.05, 0.12, 0, 0.06, -0.2, dark);
    } else if (id === 'sniper') {
      add(0.08, 0.09, 0.5, 0, 0, -0.14, body);
      add(0.04, 0.04, 0.5, 0, 0.02, -0.5, grip);
      add(0.06, 0.06, 0.16, 0, 0.07, -0.14, dark); // scope tube
      add(0.075, 0.08, 0.22, 0, -0.02, 0.22, grip);
    } else if (id === 'shotgun') {
      add(0.1, 0.11, 0.44, 0, 0, -0.1, body);
      add(0.07, 0.07, 0.36, 0, -0.03, -0.36, grip); // pump
      add(0.075, 0.08, 0.22, 0, -0.02, 0.2, grip);
    }
  }

  function def() {
    return WEAPONS[state.current];
  }

  function ammo() {
    return state.owned[state.current];
  }

  function step(dt, moving) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.bloom = Math.max(0, state.bloom - dt * 2.2);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.bobPhase += dt * (moving ? 9 : 3);
    const bob = moving ? Math.sin(state.bobPhase) * 0.006 : 0;
    model.position.z = -0.42 + state.kick;
    model.position.y = -0.2 + bob;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (def().reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const slot = ammo();
        const need = def().mag - slot.mag;
        const take = Math.min(need, slot.reserve);
        slot.mag += take;
        slot.reserve -= take;
      }
    }
    // Grenade projectiles: gravity, bounce, fuse.
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      g.vel.y -= GRAVITY * dt;
      g.mesh.position.addScaledVector(g.vel, dt);
      const p = g.mesh.position;
      PROBE.min.set(p.x - 0.09, p.y - 0.09, p.z - 0.09);
      PROBE.max.set(p.x + 0.09, p.y + 0.09, p.z + 0.09);
      let hitAxis = 0;
      for (const c of colliders) {
        if (!PROBE.intersectsBox(c)) continue;
        const dx = Math.min(p.x - c.min.x, c.max.x - p.x);
        const dz = Math.min(p.z - c.min.z, c.max.z - p.z);
        const dy = Math.min(p.y - c.min.y, c.max.y - p.y);
        if (dy <= dx && dy <= dz) {
          p.y = g.vel.y < 0 ? c.max.y + 0.09 : c.min.y - 0.09;
          g.vel.y = -g.vel.y * 0.45;
          hitAxis = 1;
        } else if (dx <= dz) {
          p.x = g.vel.x < 0 ? c.max.x + 0.09 : c.min.x - 0.09;
          g.vel.x = -g.vel.x * 0.45;
          hitAxis = 1;
        } else {
          p.z = g.vel.z < 0 ? c.max.z + 0.09 : c.min.z - 0.09;
          g.vel.z = -g.vel.z * 0.45;
          hitAxis = 1;
        }
        break;
      }
      if (hitAxis && !g.armed) {
        g.armed = true;
        g.fuse = GRENADE.fuse;
      }
      if (g.vel.lengthSq() < 0.5) g.vel.set(0, 0, 0);
      if (g.armed) {
        g.fuse -= dt;
        if (g.fuse <= 0) {
          g.onExplode(g.mesh.position.clone());
          scene.remove(g.mesh);
          grenades.splice(i, 1);
        }
      }
    }
    // Explosion flashes fade out.
    for (let i = explosionMeshes.length - 1; i >= 0; i -= 1) {
      const e = explosionMeshes[i];
      e.life -= dt;
      const t = Math.max(0, e.life / 0.35);
      e.mesh.scale.setScalar(1 + (1 - t) * 4);
      e.mesh.material.opacity = t * 0.75;
      e.light.intensity = t * 40;
      if (e.life <= 0) {
        scene.remove(e.mesh);
        scene.remove(e.light);
        explosionMeshes.splice(i, 1);
      }
    }
  }

  return {
    state,
    def,
    ammo,
    step,
    ready() {
      return ammo().mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    fire() {
      const slot = ammo();
      if (slot.mag <= 0 || state.cooldown > 0 || state.reloadLeft > 0) return false;
      slot.mag -= 1;
      state.cooldown = def().gap;
      state.flash = 0.06;
      state.kick = def().recoil * 5;
      state.bloom = Math.min(1, state.bloom + 0.3);
      return true;
    },
    reload() {
      const slot = ammo();
      if (state.reloadLeft > 0 || slot.mag === def().mag || slot.reserve === 0) return false;
      state.reloadLeft = def().reload;
      return true;
    },
    spread(speed, airborne, scoped, crouching) {
      const d = def();
      const move = Math.min(1, speed / 5.2);
      let s = d.spreadStill + move * d.spreadMove + state.bloom * 0.02;
      if (airborne) s += 0.02;
      if (crouching) s *= 0.7;
      if (scoped) s *= 0.35;
      return s;
    },
    recoilKick() {
      return def().recoil;
    },
    equip(id) {
      if (!state.owned[id]) return false;
      state.current = id;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.bloom = 0;
      buildModel(id);
      return true;
    },
    buy(id, money) {
      const w = WEAPONS[id];
      if (!w || state.owned[id] || money < w.price) return false;
      state.owned[id] = { mag: w.mag, reserve: w.reserve };
      this.equip(id);
      return true;
    },
    buyGrenade(money) {
      if (money < GRENADE.price || state.grenades >= 2) return false;
      state.grenades += 1;
      return true;
    },
    refillAmmo() {
      for (const id of Object.keys(state.owned)) {
        state.owned[id].reserve = WEAPONS[id].reserve;
        if (state.owned[id].mag === 0) state.owned[id].mag = WEAPONS[id].mag;
      }
    },
    reset() {
      state.current = 'pistol';
      state.owned = { pistol: { mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve } };
      state.grenades = 0;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.bloom = 0;
      for (const g of grenades) scene.remove(g.mesh);
      grenades.length = 0;
      buildModel('pistol');
    },
    throwGrenade(origin, direction, onExplode) {
      if (state.grenades <= 0) return false;
      state.grenades -= 1;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 10, 8),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rust), roughness: 0.5, metalness: 0.4 }),
      );
      mesh.position.copy(origin);
      mesh.castShadow = true;
      scene.add(mesh);
      const vel = direction.clone().multiplyScalar(16);
      vel.y += 4.5;
      grenades.push({ mesh, vel, armed: false, fuse: 0, onExplode });
      return true;
    },
    explodeAt(position) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 16, 12),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.75, depthWrite: false }),
      );
      mesh.position.copy(position);
      scene.add(mesh);
      const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 40, 14);
      light.position.copy(position);
      scene.add(light);
      explosionMeshes.push({ mesh, light, life: 0.35 });
    },
  };
}
