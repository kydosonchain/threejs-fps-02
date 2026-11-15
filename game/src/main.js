// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's rate.
// The player attacks with four bot teammates against five defenders: plant the spike at A
// or B, or wipe the defenders. ?shot=start|play|bomb|end with &seed=N sets up a
// deterministic frame for a capture, renders it twice, then freezes and sets
// window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SITES, SPAWNS, pointInSite } from './world.js';
import { createPlayer } from './player.js';
import { createWeapons, WEAPONS, GRENADE } from './weapons.js';
import { createBots } from './bots.js';
import { createMatch, BUY_SECONDS } from './match.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const PLANT_TIME = 3.5;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 22, 58);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const hud = createHud();
const match = createMatch(onMatchEvent);
const player = createPlayer(world.colliders, SPAWNS.attack[1]);
const weapons = createWeapons(camera, scene, world.colliders);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 120;
const shootables = world.shootables;
const direction = new THREE.Vector3();
const eyePos = new THREE.Vector3();
const noise = [];

let playerHp = 100;
let playerAlive = true;
let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let prevFiring = false;
let plantProgress = 0;
let plantSite = null;
let stepDistance = 0;
let lastStepPos = new THREE.Vector3();
let fov = 74;

const bots = createBots(scene, world, random, onBotEvent);

// Bullet tracers, pooled: no allocation in the hot loop.
const tracers = [];
for (let i = 0; i < 6; i += 1) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0 }));
  line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, life: 0 });
}
let tracerIndex = 0;

let bombMesh = null;
let bombLight = null;
let spikeMesh = null;

function fireTracer(from, to) {
  const tracer = tracers[tracerIndex];
  tracerIndex = (tracerIndex + 1) % tracers.length;
  const positions = tracer.line.geometry.attributes.position.array;
  positions[0] = from.x;
  positions[1] = from.y;
  positions[2] = from.z;
  positions[3] = to.x;
  positions[4] = to.y;
  positions[5] = to.z;
  tracer.line.geometry.attributes.position.needsUpdate = true;
  tracer.line.material.opacity = 0.85;
  tracer.life = 0.09;
}

function showBomb(position) {
  hideBomb();
  bombMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.26, 0.55),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.4, metalness: 0.3, emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.4 }),
  );
  bombMesh.position.set(position.x, 0.13, position.z);
  bombMesh.castShadow = true;
  scene.add(bombMesh);
  bombLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 12, 8);
  bombLight.position.set(position.x, 0.8, position.z);
  scene.add(bombLight);
}

function hideBomb() {
  if (bombMesh) scene.remove(bombMesh);
  if (bombLight) scene.remove(bombLight);
  bombMesh = null;
  bombLight = null;
}

function showSpike(position) {
  hideSpike();
  spikeMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.3, 0.22),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.3, metalness: 0.5, emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.7 }),
  );
  spikeMesh.position.set(position.x, 0.4, position.z);
  scene.add(spikeMesh);
}

function hideSpike() {
  if (spikeMesh) scene.remove(spikeMesh);
  spikeMesh = null;
}

function onMatchEvent(event) {
  if (event.type === 'roundStart') {
    resetRound();
  } else if (event.type === 'liveStart') {
    hud.hideBuyMenu();
    hud.setObjective('Plant the spike at A or B — or eliminate the Sentinel squad.');
    hud.hideBanner();
  } else if (event.type === 'roundEnd') {
    hud.hideBuyMenu();
    const won = event.winner === 'attack';
    const reasonText = { eliminated: 'Squad eliminated', detonation: 'Spike detonated', defused: 'Spike defused', time: 'Time expired' }[event.reason] || '';
    hud.showBanner(won ? 'ROUND WON' : 'ROUND LOST', `${reasonText} · Vanguard ${event.wins.attack} — ${event.wins.defend} Sentinel`, won);
    if (won) audio.roundWin();
    else audio.roundLose();
    hideBomb();
    hideSpike();
    plantProgress = 0;
    plantSite = null;
    hud.setPlantProgress(null);
  } else if (event.type === 'matchEnd') {
    hud.showOverlay('matchEnd', { winner: event.winner, wins: event.wins, kills: match.state.kills });
    if (document.pointerLockElement) document.exitPointerLock();
  } else if (event.type === 'bombPlanted') {
    showBomb(event.position);
    hud.setObjective(`Spike planted at ${event.site} — defend it until detonation.`);
    hud.showBanner('SPIKE PLANTED', `Detonation in 40 seconds — hold ${event.site}.`, true);
    audio.plant();
  } else if (event.type === 'bombExploded') {
    weapons.explodeAt(new THREE.Vector3(match.state.bomb.position?.x || 0, 0.5, match.state.bomb.position?.z || 0));
    audio.explosion();
    noise.push({ x: 0, z: -11, kind: 'explosion' });
    hideBomb();
  } else if (event.type === 'bombDefused') {
    hideBomb();
  }
}

function onBotEvent(event) {
  if (event.type === 'shot') {
    const d = Math.hypot(event.position.x - player.state.position.x, event.position.z - player.state.position.z);
    if (d < 42) audio.shot(event.weapon === 'sniper' ? 'sniper' : event.weapon === 'shotgun' ? 'shotgun' : 'rifle');
    noise.push({ x: event.position.x, z: event.position.z, kind: 'gunshot' });
  } else if (event.type === 'damagePlayer') {
    if (!playerAlive) return;
    playerHp -= event.amount;
    hud.damageFlash();
    audio.hurt();
    if (playerHp <= 0) {
      playerHp = 0;
      playerAlive = false;
      match.addDeath();
      if (match.state.spike.carrier === 'player') {
        match.dropSpike(player.state.position);
        showSpike(player.state.position);
      }
      hud.showOverlay('dead', {});
      if (document.pointerLockElement) document.exitPointerLock();
    }
  } else if (event.type === 'death') {
    const killerName = event.killer === 'player' ? 'YOU' : event.killer.id.toUpperCase();
    const victimName = event.bot.id.toUpperCase();
    const friendlyKill = event.killer !== 'player' && event.killer.team === 'attack';
    hud.killfeedAdd(`${killerName} ✕ ${victimName}${event.head ? ' (headshot)' : ''}`, event.killer === 'player' || friendlyKill);
    if (event.killer === 'player') {
      match.addKill();
      audio.hit(event.head);
    }
  } else if (event.type === 'plantDone') {
    match.plantBomb(event.site, event.position, event.bot);
  } else if (event.type === 'plantProgress') {
    hud.setPlantProgress(event.progress, 'SPIKE BEING PLANTED');
  } else if (event.type === 'defuseDone') {
    match.defuseBomb(event.bot);
  } else if (event.type === 'defuseProgress') {
    hud.setPlantProgress(event.progress, 'SPIKE BEING DEFUSED');
  } else if (event.type === 'spikeDropped') {
    match.dropSpike(event.position);
    showSpike(event.position);
  }
}

function resetRound() {
  const spawn = SPAWNS.attack[Math.floor(random() * SPAWNS.attack.length)];
  player.teleport(spawn[0], spawn[1], 0);
  playerHp = 100;
  playerAlive = true;
  weapons.refillAmmo();
  weapons.equip('pistol');
  bots.spawnRound();
  hud.hideBanner();
  hud.setObjective('Buy phase — spend your money, then push a site.');
  hud.showBuyMenu();
  hud.refreshBuyMenu(match.state.money, weapons.state.owned);
  hud.setPlantProgress(null);
  hideBomb();
  hideSpike();
  plantProgress = 0;
  plantSite = null;
  lastStepPos.copy(player.state.position);
  stepDistance = 0;
}

function startMatch() {
  match.startMatch();
  weapons.reset();
  resetRound();
  if (!shot) hud.showOverlay('start', {});
}

hud.onPlay(() => {
  audio.unlock();
  if (shot) return;
  if (match.state.phase === 'matchEnd') {
    startMatch();
    hud.hideOverlay();
    hud.showBuyMenu();
    hud.refreshBuyMenu(match.state.money, weapons.state.owned);
    return;
  }
  if (match.state.phase === 'buy') {
    // Stay unlocked so the mouse is free to buy; lock comes from the buy menu's close.
    hud.hideOverlay();
    hud.showBuyMenu();
    hud.refreshBuyMenu(match.state.money, weapons.state.owned);
    return;
  }
  if (!playerAlive) {
    hud.hideOverlay();
    return;
  }
  input.requestLock();
});

hud.buildBuyMenu((id) => tryBuy(id));
hud.onBuyClose(() => {
  hud.hideBuyMenu();
  input.requestLock();
});

function tryBuy(id) {
  if (match.state.phase !== 'buy') return;
  if (id === 'grenade') {
    if (weapons.buyGrenade(match.state.money)) {
      match.spend(GRENADE.price);
      audio.buy();
    }
  } else if (weapons.state.owned[id]) {
    weapons.equip(id);
    audio.buy();
  } else if (weapons.buy(id, match.state.money)) {
    match.spend(WEAPONS[id].price);
    audio.buy();
  }
  hud.setMoney(match.state.money);
  hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve, weapons.def().name, weapons.state.grenades);
  hud.refreshBuyMenu(match.state.money, weapons.state.owned);
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (match.state.phase === 'matchEnd') {
    hud.showOverlay('matchEnd', { winner: match.state.wins.attack > match.state.wins.defend ? 'attack' : 'defend', wins: match.state.wins, kills: match.state.kills });
  } else if (!playerAlive) {
    hud.showOverlay('dead', {});
  } else if (match.state.phase === 'buy') {
    hud.showOverlay('paused', {});
  } else if (!frozen) {
    hud.showOverlay('paused', {});
  }
}

function syncCamera() {
  const body = player.state;
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  const targetFov = player.state.scoped ? 32 : 74;
  if (Math.abs(fov - targetFov) > 0.2) {
    fov += (targetFov - fov) * 0.25;
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

function aimAt(point) {
  const body = player.state;
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function shoot() {
  if (!weapons.fire()) {
    if (weapons.ammo().mag === 0) {
      audio.dryFire();
      weapons.reload();
    }
    return false;
  }
  const body = player.state;
  const spread = weapons.spread(player.groundSpeed(), !body.onGround, body.scoped, body.crouching);
  camera.getWorldDirection(direction);
  const pellets = weapons.def().pellets;
  let hitSomething = false;
  for (let p = 0; p < pellets; p += 1) {
    const dir = direction.clone();
    dir.x += (random() * 2 - 1) * spread;
    dir.y += (random() * 2 - 1) * spread;
    dir.z += (random() * 2 - 1) * spread;
    dir.normalize();
    scene.updateMatrixWorld(true);
    raycaster.set(camera.position, dir);
    const hit = raycaster.intersectObjects(shootables.concat(bots.hitMeshes), false)[0];
    const end = hit ? hit.point : camera.position.clone().addScaledVector(dir, 60);
    fireTracer(camera.position, end);
    if (!hit) continue;
    hitSomething = true;
    if (hit.object.userData.bot) {
      const victim = hit.object.userData.bot;
      if (!victim.alive) continue;
      if (victim.team === 'attack') continue; // no friendly fire
      const head = hit.object.userData.part === 'head';
      const def = weapons.def();
      let damage = def.damage * (head ? def.headMult : 1);
      const distance = hit.distance;
      if (distance > 25) damage *= 0.85;
      if (distance > 40) damage *= 0.8;
      const wasAlive = victim.alive;
      bots.applyDamage(victim, Math.round(damage), 'player', head, elapsed);
      if (wasAlive) {
        hud.hitMarker(!victim.alive);
        audio.hit(head);
      }
    }
  }
  const kick = weapons.recoilKick();
  player.recoil(kick + random() * 0.004, (random() * 2 - 1) * 0.004);
  audio.shot(weapons.def().scope ? 'sniper' : weapons.state.current);
  noise.push({ x: body.position.x, z: body.position.z, kind: 'gunshot' });
  hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve, weapons.def().name, weapons.state.grenades);
  return hitSomething;
}

function throwGrenade() {
  eyePos.copy(camera.position);
  camera.getWorldDirection(direction);
  const thrown = weapons.throwGrenade(eyePos, direction, (position) => {
    weapons.explodeAt(position);
    audio.explosion();
    noise.push({ x: position.x, z: position.z, kind: 'explosion' });
    const radius = GRENADE.radius;
    for (const bot of bots.bots) {
      if (!bot.alive) continue;
      const d = Math.hypot(bot.body.group.position.x - position.x, bot.body.group.position.z - position.z);
      if (d < radius) {
        const damage = Math.round(GRENADE.maxDamage * (1 - d / radius) + 20);
        bots.applyDamage(bot, damage, 'player', false, elapsed);
      }
    }
    if (playerAlive) {
      const d = Math.hypot(player.state.position.x - position.x, player.state.position.z - position.z);
      if (d < radius) {
        playerHp -= Math.round(GRENADE.maxDamage * (1 - d / radius) + 20);
        hud.damageFlash();
        if (playerHp <= 0) {
          playerHp = 0;
          playerAlive = false;
          match.addDeath();
          if (match.state.spike.carrier === 'player') {
            match.dropSpike(player.state.position);
            showSpike(player.state.position);
          }
          hud.showOverlay('dead', {});
          if (document.pointerLockElement) document.exitPointerLock();
        }
      }
    }
  });
  if (thrown) {
    hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve, weapons.def().name, weapons.state.grenades);
  }
  return thrown;
}

function updatePlant(dt) {
  const body = player.state;
  plantSite = null;
  if (match.state.phase !== 'live' || !playerAlive || match.state.spike.carrier !== 'player' || match.state.bomb.planted) {
    if (plantProgress > 0) {
      plantProgress = 0;
      hud.setPlantProgress(null);
    }
    return;
  }
  for (const site of Object.values(SITES)) {
    if (pointInSite(body.position, site)) {
      plantSite = site;
      break;
    }
  }
  if (!plantSite) {
    if (plantProgress > 0) {
      plantProgress = 0;
      hud.setPlantProgress(null);
    }
    return;
  }
  const nearEnemy = bots.bots.some((b) => b.alive && b.team === 'defend' && Math.hypot(b.body.group.position.x - body.position.x, b.body.group.position.z - body.position.z) < 12);
  if (nearEnemy) {
    hud.setPlantProgress(plantProgress / PLANT_TIME, 'SITE NOT CLEAR — CLEAR THE DEFENDERS');
    return;
  }
  if (input.state.keys.has('KeyE')) {
    plantProgress += dt;
    hud.setPlantProgress(plantProgress / PLANT_TIME, `PLANTING SPIKE AT ${plantSite.name} — HOLD E`);
    if (plantProgress >= PLANT_TIME) {
      match.plantBomb(plantSite.name, body.position, 'player');
      plantProgress = 0;
      hud.setPlantProgress(null);
    }
  } else if (plantProgress > 0) {
    plantProgress = 0;
    hud.setPlantProgress(null);
  }
}

function updateSpikePickup() {
  if (match.state.phase !== 'live' || !playerAlive) return;
  if (match.state.spike.carrier === 'player' || match.state.bomb.planted) return;
  if (match.state.spike.droppedAt) {
    const d = Math.hypot(player.state.position.x - match.state.spike.droppedAt.x, player.state.position.z - match.state.spike.droppedAt.z);
    if (d < 1.6) {
      match.state.spike = { carrier: 'player', droppedAt: null };
      hideSpike();
      hud.setObjective('Spike recovered — plant it at A or B.');
    }
    return;
  }
  // No carrier and no drop: a friendly bot should carry it.
  const carrier = bots.spikeCarrier();
  if (!carrier) {
    const bot = bots.giveSpikeToNearest(player.state.position);
    if (bot) match.giveSpikeToBot(bot);
  }
}

function step(dt) {
  elapsed += dt;
  const body = player.state;
  const firing = input.state.firing;
  if (playerAlive) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    const scoped = input.state.scoped && weapons.def().scope === true;
    body.scoped = scoped;
    const def = weapons.def();
    if (firing && weapons.ready()) {
      if (def.auto || !prevFiring) shoot();
    }
    if (input.takePress('KeyR')) {
      if (weapons.reload()) audio.reload();
    }
    if (input.takePress('KeyG')) throwGrenade();
    if (input.takePress('KeyB') && match.state.phase === 'buy') {
      hud.showBuyMenu();
      hud.refreshBuyMenu(match.state.money, weapons.state.owned);
      if (document.pointerLockElement) document.exitPointerLock();
    }
    const slots = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];
    const ids = ['pistol', 'smg', 'rifle', 'shotgun', 'sniper'];
    slots.forEach((code, index) => {
      if (input.takePress(code)) {
        const id = ids[index];
        if (weapons.state.owned[id]) weapons.equip(id);
        else if (match.state.phase === 'buy') tryBuy(id);
      }
    });
    if (input.takePress('Digit6') && match.state.phase === 'buy') tryBuy('grenade');
    if (input.takePress('KeyM')) audio.toggleMute();
    player.step(dt, input.state.keys, def.speed);
    // Footsteps: sound and a small noise bots can hear.
    stepDistance += Math.hypot(body.position.x - lastStepPos.x, body.position.z - lastStepPos.z);
    lastStepPos.copy(body.position);
    if (body.onGround && player.groundSpeed() > 1.5 && stepDistance > 2.2) {
      stepDistance = 0;
      audio.footstep();
      noise.push({ x: body.position.x, z: body.position.z, kind: 'footstep' });
    }
    updatePlant(dt);
    updateSpikePickup();
  }
  prevFiring = firing;
  weapons.step(dt, playerAlive && player.groundSpeed() > 0.5);
  bots.step(dt, elapsed, {
    playerAlive,
    playerPos: body.position,
    noise,
    bomb: match.state.bomb,
  });
  match.step(dt, {
    attackersAlive: (playerAlive ? 1 : 0) + bots.aliveCount('attack'),
    defendersAlive: bots.aliveCount('defend'),
  });
  if (bombLight) bombLight.intensity = 8 + Math.sin(elapsed * 8) * 6;
  if (spikeMesh) {
    spikeMesh.rotation.y += dt * 2;
    spikeMesh.position.y = 0.4 + Math.sin(elapsed * 3) * 0.08;
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    for (const tracer of tracers) {
      if (tracer.life > 0) {
        tracer.life -= dt;
        tracer.line.material.opacity = Math.max(0, tracer.life / 0.09) * 0.85;
      }
    }
    // HUD values are cached inside hud.js: unchanged values skip the DOM write.
    hud.setHealth(playerHp);
    hud.setMoney(match.state.money);
    hud.setTimer(match.state.timer, match.state.phase);
    hud.setScore(match.state.wins.attack, match.state.wins.defend, match.state.round);
    hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve, weapons.def().name, weapons.state.grenades);
    const spread = weapons.spread(player.groundSpeed(), !player.state.onGround, player.state.scoped, player.state.crouching);
    hud.setCrosshairGap(6 + spread * 600);
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuyMenu();
  if (name === 'start') {
    match.startMatch();
    weapons.reset();
    resetRound();
    player.teleport(0, 13.5, 0);
    settle(20);
    hud.showBuyMenu();
    hud.refreshBuyMenu(match.state.money, weapons.state.owned);
    hud.setMoney(match.state.money);
  } else if (name === 'play') {
    match.startMatch();
    weapons.reset();
    resetRound();
    match.beginLive();
    weapons.state.owned.rifle = { mag: WEAPONS.rifle.mag, reserve: WEAPONS.rifle.reserve };
    weapons.equip('rifle');
    settle(480);
    // Find a vantage with a real sightline to a living defender, so the frame shows combat.
    scene.updateMatrixWorld(true);
    const vantages = [[-14, -5], [14, -5], [0, -5], [-5, 5], [5, 5], [0, 9]];
    let target = null;
    for (const [vx, vz] of vantages) {
      for (const enemy of bots.bots) {
        if (!enemy.alive || enemy.team !== 'defend') continue;
        const from = new THREE.Vector3(vx, 1.5, vz);
        const to = new THREE.Vector3(enemy.body.group.position.x, 1.3, enemy.body.group.position.z);
        const dir = to.clone().sub(from);
        const dist = dir.length();
        raycaster.set(from, dir.normalize());
        const hit = raycaster.intersectObjects(shootables, false)[0];
        if (!hit || hit.distance > dist - 0.5) {
          target = { vx, vz, enemy };
          break;
        }
      }
      if (target) break;
    }
    if (target) {
      player.teleport(target.vx, target.vz, 0);
      const aimPoint = () => new THREE.Vector3(target.enemy.body.group.position.x, 1.3, target.enemy.body.group.position.z);
      aimAt(aimPoint());
      shoot();
      settle(10);
      aimAt(aimPoint());
    } else {
      player.teleport(0, 5, 0);
    }
    hud.setMoney(match.state.money);
  } else if (name === 'bomb') {
    match.startMatch();
    weapons.reset();
    resetRound();
    match.beginLive();
    settle(120);
    // Stand off the site and look at the planted spike, so the bomb is in frame.
    player.teleport(-12.5, -6, 0);
    match.plantBomb('A', new THREE.Vector3(-15.5, 0, -11), 'player');
    settle(30);
    aimAt(new THREE.Vector3(-15.5, 0.4, -11));
    hud.setMoney(match.state.money);
  } else if (name === 'end') {
    match.startMatch();
    weapons.reset();
    resetRound();
    match.beginLive();
    match.state.wins = { attack: 3, defend: 2 };
    settle(120);
    player.teleport(-15.5, -8, 0);
    for (const bot of bots.bots) {
      if (bot.team === 'defend' && bot.alive) bots.applyDamage(bot, 200, 'player', false, elapsed);
    }
    settle(30);
    // The round-end banner from the match event already shows; leave its reason honest.
    aimAt(new THREE.Vector3(-15.5, 1, -11));
    hud.setMoney(match.state.money);
  }
  hud.setHealth(playerHp);
  hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve, weapons.def().name, weapons.state.grenades);
  hud.setScore(match.state.wins.attack, match.state.wins.defend, match.state.round);
  hud.setTimer(match.state.timer, match.state.phase);
  // A capture must show the player alive and the screen clear, whatever the settle did.
  if (!playerAlive) {
    playerAlive = true;
    playerHp = 100;
  }
  hud.hideOverlay();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Debug handle for local smoke tests: read-only game state, no gameplay effect.
window.__duskline = {
  get state() {
    return {
      phase: match.state.phase,
      round: match.state.round,
      wins: { ...match.state.wins },
      timer: match.state.timer,
      money: match.state.money,
      hp: playerHp,
      alive: playerAlive,
      position: [player.state.position.x, player.state.position.y, player.state.position.z],
      yaw: player.state.yaw,
      weapon: weapons.state.current,
      mag: weapons.ammo().mag,
      botsAlive: { attack: bots.aliveCount('attack'), defend: bots.aliveCount('defend') },
    };
  },
};

hud.setHealth(playerHp);
hud.setMoney(match.state.money);
hud.setScore(0, 0, 1);
hud.setTimer(BUY_SECONDS, 'buy');
hud.setObjective('Buy phase — spend your money, then push a site.');
syncCamera();
if (shot) {
  runShot(shot);
} else {
  startMatch();
  requestAnimationFrame(frame);
}
