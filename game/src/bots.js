// Bot agents: five defenders hold the sites and rotate on sound; four attackers push the
// lanes with the player. Each bot is a small state machine (move, hold, engage, plant,
// defuse, rotate) over a hand-placed waypoint graph, with line-of-sight checks, hearing,
// reaction time and burst fire with real aim error. Bots shoot with the same raycast the
// player does, so a bot only hits what its bullet actually reaches.
import * as THREE from 'three';
import { WAYPOINTS, SITES, SPAWNS, pointInSite } from './world.js';
import { WEAPONS } from './weapons.js';

const BOT_SPEED = 3.9;
const BOT_HP = 100;
const EYE_HEIGHT = 1.5;
const LOS_INTERVAL = 0.12;
const HEAR_GUNSHOT = 30;
const HEAR_FOOTSTEP = 8;
const HEAR_EXPLOSION = 45;
const PLANT_TIME = 3.5;
const DEFUSE_TIME = 5;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();

function bfsPath(from, to) {
  if (from === to) return [to];
  const queue = [[from]];
  const seen = new Set([from]);
  while (queue.length) {
    const path = queue.shift();
    const node = path[path.length - 1];
    for (const next of WAYPOINTS[node][2]) {
      if (seen.has(next)) continue;
      if (next === to) return [...path, next];
      seen.add(next);
      queue.push([...path, next]);
    }
  }
  return [to];
}

function nearestWaypoint(x, z) {
  let best = null;
  let bestD = Infinity;
  for (const [id, node] of Object.entries(WAYPOINTS)) {
    const d = (node[0] - x) ** 2 + (node[1] - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

function makeBody(team, scene) {
  const group = new THREE.Group();
  const torsoMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(team === 'attack' ? '#46c2b0' : '#e04f3a'),
    roughness: 0.7, metalness: 0.05,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#241c14'), roughness: 0.85 });
  const headMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c8a06a'), roughness: 0.6 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.72, 0.3), torsoMat);
  torso.position.y = 1.08;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), headMat);
  head.position.y = 1.58;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), darkMat);
  helmet.position.y = 1.6;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.72, 0.2), darkMat);
  legL.position.set(-0.13, 0.36, 0);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.72, 0.2), darkMat);
  legR.position.set(0.13, 0.36, 0);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), darkMat);
  gun.position.set(0.2, 1.15, -0.2);
  group.add(torso, head, helmet, legL, legR, gun);
  group.traverse((mesh) => {
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  scene.add(group);
  return { group, torso, head, legL, legR, gun };
}

export function createBots(scene, world, rng, onEvent) {
  const colliders = world.colliders;
  const shootables = world.shootables;
  const bots = [];
  const hitMeshes = [];
  const raycaster = new THREE.Raycaster();
  raycaster.far = 90;
  const probe = new THREE.Box3();

  function overlaps(x, z) {
    probe.min.set(x - 0.34, 0.05, z - 0.34);
    probe.max.set(x + 0.34, 1.7, z + 0.34);
    for (const c of colliders) if (probe.intersectsBox(c)) return true;
    return false;
  }

  function makeBot(team, index, spawn) {
    const body = makeBody(team, scene);
    const bot = {
      id: `${team}-${index}`,
      team,
      index,
      body,
      hp: BOT_HP,
      alive: true,
      state: 'move',
      yaw: team === 'attack' ? Math.PI : 0,
      path: [],
      pathIndex: 0,
      holdId: null,
      holdYaw: 0,
      sweep: 0,
      target: null,
      lastSeen: null,
      reactAt: 0,
      burstLeft: 0,
      burstTimer: 0,
      pauseTimer: 0,
      losTimer: index * 0.013,
      skill: 0.55 + rng() * 0.35,
      reaction: 0.4 + rng() * 0.35,
      weapon: team === 'attack' ? 'rifle' : index % 2 === 0 ? 'rifle' : 'smg',
      hasSpike: false,
      channel: 0,
      channelKind: null,
      heard: null,
      walkPhase: rng() * 6,
      fall: 0,
      speed: BOT_SPEED * (0.92 + rng() * 0.16),
    };
    body.group.position.set(spawn[0], 0, spawn[1]);
    body.torso.userData.bot = bot;
    body.torso.userData.part = 'torso';
    body.head.userData.bot = bot;
    body.head.userData.part = 'head';
    hitMeshes.push(body.torso, body.head);
    bots.push(bot);
    return bot;
  }

  function spawnRound() {
    for (const bot of bots) {
      scene.remove(bot.body.group);
    }
    bots.length = 0;
    hitMeshes.length = 0;
    const attackSpawns = [...SPAWNS.attack];
    const defendSpawns = [...SPAWNS.defend];
    const attackPlans = ['aSite', 'aSite', 'bSite', 'bSite'];
    for (let i = 0; i < 4; i += 1) {
      const bot = makeBot('attack', i, attackSpawns[i]);
      bot.goal = attackPlans[i];
      bot.path = bfsPath(nearestWaypoint(bot.body.group.position.x, bot.body.group.position.z), bot.goal);
      bot.pathIndex = 0;
    }
    const defendHolds = ['aHold1', 'aHold2', 'bHold1', 'bHold2'];
    for (let i = 0; i < 5; i += 1) {
      const bot = makeBot('defend', i, defendSpawns[i]);
      if (i === 4) {
        bot.state = 'hold';
        bot.holdId = 'ctMid';
        bot.goal = 'ctMid';
        bot.path = bfsPath(nearestWaypoint(bot.body.group.position.x, bot.body.group.position.z), 'ctMid');
      } else {
        bot.state = 'hold';
        bot.holdId = defendHolds[i];
        bot.goal = defendHolds[i];
        bot.path = bfsPath(nearestWaypoint(bot.body.group.position.x, bot.body.group.position.z), defendHolds[i]);
      }
      bot.pathIndex = 0;
    }
  }

  function eyeOf(bot) {
    _v1.set(bot.body.group.position.x, EYE_HEIGHT, bot.body.group.position.z);
    return _v1;
  }

  function canSee(bot, targetPos, targetMeshes) {
    _dir.copy(targetPos).sub(eyeOf(bot));
    const distance = _dir.length();
    if (distance > 70) return false;
    _dir.normalize();
    raycaster.set(eyeOf(bot), _dir);
    const hits = raycaster.intersectObjects(shootables.concat(targetMeshes), false);
    if (!hits.length) return targetMeshes.length === 0;
    const first = hits[0];
    // The first surface lies past the target: nothing blocks the view.
    if (first.distance > distance + 0.5) return targetMeshes.length === 0;
    return targetMeshes.includes(first.object);
  }

  function faceToward(bot, x, z, dt, rate = 6) {
    const want = Math.atan2(-(x - bot.body.group.position.x), -(z - bot.body.group.position.z));
    let diff = want - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.yaw += Math.max(-rate * dt, Math.min(rate * dt, diff));
  }

  function moveAlongPath(bot, dt) {
    if (bot.pathIndex >= bot.path.length) return true;
    const node = WAYPOINTS[bot.path[bot.pathIndex]];
    const dx = node[0] - bot.body.group.position.x;
    const dz = node[1] - bot.body.group.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.6) {
      bot.pathIndex += 1;
      return bot.pathIndex >= bot.path.length;
    }
    const step = bot.speed * dt;
    const nx = bot.body.group.position.x + (dx / dist) * step;
    const nz = bot.body.group.position.z + (dz / dist) * step;
    if (!overlaps(nx, bot.body.group.position.z)) bot.body.group.position.x = nx;
    if (!overlaps(bot.body.group.position.x, nz)) bot.body.group.position.z = nz;
    faceToward(bot, node[0], node[1], dt);
    bot.walkPhase += dt * 9;
    return false;
  }

  function setPath(bot, goalId) {
    bot.goal = goalId;
    bot.path = bfsPath(nearestWaypoint(bot.body.group.position.x, bot.body.group.position.z), goalId);
    bot.pathIndex = 0;
    bot.state = 'move';
  }

  function fireAt(bot, targetPos, targetKind, time) {
    const w = WEAPONS[bot.weapon];
    const distance = Math.hypot(targetPos.x - bot.body.group.position.x, targetPos.z - bot.body.group.position.z);
    const targetSpeed = targetKind === 'player' ? 0 : 0; // bots strafe slowly; error covers it
    const error = 0.012 + (1 - bot.skill) * 0.03 + distance * 0.0004 + targetSpeed * 0.002;
    _dir.copy(targetPos).sub(eyeOf(bot)).normalize();
    _dir.x += (rng() * 2 - 1) * error;
    _dir.y += (rng() * 2 - 1) * error;
    _dir.z += (rng() * 2 - 1) * error;
    _dir.normalize();
    raycaster.set(eyeOf(bot), _dir);
    const hits = raycaster.intersectObjects(shootables.concat(hitMeshes), false);
    onEvent({ type: 'shot', bot, position: eyeOf(bot).clone(), weapon: bot.weapon });
    if (!hits.length) return;
    const first = hits[0];
    if (first.distance > distance + 1.5) return;
    if (first.object.userData.bot) {
      const victim = first.object.userData.bot;
      if (victim.team === bot.team || !victim.alive) return;
      const head = first.object.userData.part === 'head';
      let damage = w.damage * (head ? w.headMult : 1);
      if (distance > 25) damage *= 0.85;
      if (distance > 40) damage *= 0.8;
      applyDamage(victim, Math.round(damage), bot, head, time);
    }
  }

  function fireAtPlayer(bot, playerPos, time) {
    const w = WEAPONS[bot.weapon];
    const distance = Math.hypot(playerPos.x - bot.body.group.position.x, playerPos.z - bot.body.group.position.z);
    const error = 0.012 + (1 - bot.skill) * 0.03 + distance * 0.0004;
    _dir.copy(playerPos).sub(eyeOf(bot)).normalize();
    _dir.x += (rng() * 2 - 1) * error;
    _dir.y += (rng() * 2 - 1) * error * 0.7;
    _dir.z += (rng() * 2 - 1) * error;
    _dir.normalize();
    raycaster.set(eyeOf(bot), _dir);
    const hits = raycaster.intersectObjects(shootables.concat(hitMeshes), false);
    onEvent({ type: 'shot', bot, position: eyeOf(bot).clone(), weapon: bot.weapon });
    if (!hits.length) return;
    const first = hits[0];
    if (first.distance > distance + 1.5) return;
    if (first.object.userData.bot) {
      const victim = first.object.userData.bot;
      if (victim.team === bot.team || !victim.alive) return;
      const head = first.object.userData.part === 'head';
      let damage = w.damage * (head ? w.headMult : 1);
      if (distance > 25) damage *= 0.85;
      if (distance > 40) damage *= 0.8;
      applyDamage(victim, Math.round(damage), bot, head, time);
      return;
    }
    // Nothing between the bot and the player: the shot lands.
    let damage = w.damage;
    if (distance > 25) damage *= 0.85;
    if (distance > 40) damage *= 0.8;
    onEvent({ type: 'damagePlayer', amount: Math.round(damage), attacker: bot, head: false });
  }

  function applyDamage(bot, amount, attacker, head, time) {
    if (!bot.alive) return;
    bot.hp -= amount;
    bot.channel = 0;
    bot.channelKind = null;
    if (bot.hp <= 0) {
      bot.hp = 0;
      bot.alive = false;
      bot.fall = 0;
      bot.state = 'dead';
      if (bot.hasSpike) {
        bot.hasSpike = false;
        onEvent({ type: 'spikeDropped', position: bot.body.group.position.clone() });
      }
      onEvent({ type: 'death', bot, killer: attacker, head, time });
    }
  }

  function stepBot(bot, dt, time, ctx) {
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / 0.4);
      bot.body.group.rotation.x = -bot.fall * 1.5;
      return;
    }
    const group = bot.body.group;
    const playerPos = ctx.playerAlive ? ctx.playerPos : null;
    const enemies = bots.filter((b) => b.alive && b.team !== bot.team);

    // Perception, staggered so not every bot raycasts every step.
    bot.losTimer -= dt;
    if (bot.losTimer <= 0) {
      bot.losTimer = LOS_INTERVAL;
      bot.target = null;
      if (playerPos && bot.team === 'defend') {
        _v2.set(playerPos.x, playerPos.y + 1.2, playerPos.z);
        if (canSee(bot, _v2, [])) {
          bot.target = { kind: 'player', pos: _v2.clone(), mesh: null };
        }
      }
      if (!bot.target) {
        for (const enemy of enemies) {
          _v2.set(enemy.body.group.position.x, 1.2, enemy.body.group.position.z);
          if (canSee(bot, _v2, [enemy.body.torso, enemy.body.head])) {
            bot.target = { kind: 'bot', pos: _v2.clone(), bot: enemy };
            break;
          }
        }
      }
      if (bot.target && !bot.lastSeen) {
        bot.reactAt = time + bot.reaction;
        bot.burstLeft = 0;
        bot.pauseTimer = 0;
      }
      if (bot.target) bot.lastSeen = bot.target.pos.clone();
      else if (bot.lastSeen && time - (bot.lastSeenAt || 0) > 2.5) bot.lastSeen = null;
      if (bot.target) bot.lastSeenAt = time;
    }

    // Hearing: noise events pull bots toward the sound.
    for (const noise of ctx.noise) {
      const d = Math.hypot(noise.x - group.position.x, noise.z - group.position.z);
      const radius = noise.kind === 'explosion' ? HEAR_EXPLOSION : noise.kind === 'footstep' ? HEAR_FOOTSTEP : HEAR_GUNSHOT;
      if (d < radius && bot.state !== 'engage' && bot.state !== 'plant' && bot.state !== 'defuse') {
        bot.heard = { x: noise.x, z: noise.z };
        if (bot.team === 'defend' && bot.state === 'hold') {
          faceToward(bot, noise.x, noise.z, dt, 8);
        }
      }
    }

    // Bomb logic overrides movement.
    if (ctx.bomb.planted) {
      if (bot.team === 'defend' && bot.state !== 'defuse' && bot.state !== 'dead') {
        const d = Math.hypot(ctx.bomb.position.x - group.position.x, ctx.bomb.position.z - group.position.z);
        if (d < 1.6) {
          bot.state = 'defuse';
          bot.channel = 0;
          bot.channelKind = 'defuse';
        } else if (bot.state !== 'move' || bot.goal !== ctx.bomb.site) {
          setPath(bot, ctx.bomb.site === 'A' ? 'aSite' : 'bSite');
        }
      }
      if (bot.team === 'attack' && bot.hasSpike) bot.hasSpike = false;
    } else if (bot.hasSpike && bot.team === 'attack') {
      const site = SITES[bot.goal === 'bSite' ? 'B' : 'A'];
      if (pointInSite(group.position, site)) {
        const nearEnemy = enemies.some((e) => Math.hypot(e.body.group.position.x - group.position.x, e.body.group.position.z - group.position.z) < 12);
        if (!nearEnemy && !bot.target) {
          bot.state = 'plant';
          bot.channel += dt;
          bot.channelKind = 'plant';
          onEvent({ type: 'plantProgress', bot, progress: bot.channel / PLANT_TIME });
          if (bot.channel >= PLANT_TIME) {
            bot.hasSpike = false;
            bot.state = 'hold';
            bot.channel = 0;
            bot.channelKind = null;
            onEvent({ type: 'plantDone', bot, site: site.name, position: group.position.clone() });
          }
          return;
        }
      } else if (bot.state !== 'move' || bot.goal !== (bot.goalSite || bot.goal)) {
        setPath(bot, bot.goalSite || bot.goal);
      }
    }

    if (bot.state === 'defuse') {
      faceToward(bot, ctx.bomb.position.x, ctx.bomb.position.z, dt);
      bot.channel += dt;
      bot.channelKind = 'defuse';
      onEvent({ type: 'defuseProgress', bot, progress: bot.channel / DEFUSE_TIME });
      if (bot.channel >= DEFUSE_TIME) {
        bot.state = 'hold';
        bot.channel = 0;
        bot.channelKind = null;
        onEvent({ type: 'defuseDone', bot });
      }
      return;
    }
    if (bot.state === 'plant') return;

    // Combat: face and burst-fire once the reaction delay passes.
    if (bot.target && time >= bot.reactAt) {
      bot.state = 'engage';
      const t = bot.target;
      faceToward(bot, t.pos.x, t.pos.z, dt, 10);
      bot.burstTimer -= dt;
      if (bot.burstLeft <= 0 && bot.burstTimer <= 0) {
        bot.burstLeft = 3 + Math.floor(rng() * 3);
        bot.burstTimer = WEAPONS[bot.weapon].gap;
        bot.pauseTimer = 0;
      }
      if (bot.burstLeft > 0) {
        if (bot.burstTimer <= 0) {
          if (t.kind === 'player') fireAtPlayer(bot, _v2.set(t.pos.x, t.pos.y, t.pos.z), time);
          else fireAt(bot, t.pos, 'bot', time);
          bot.burstLeft -= 1;
          bot.burstTimer = WEAPONS[bot.weapon].gap;
          if (bot.burstLeft === 0) bot.pauseTimer = 0.5 + rng() * 0.4;
        }
      } else {
        bot.pauseTimer -= dt;
        if (bot.pauseTimer <= 0) bot.burstTimer = 0;
      }
      // Strafe a little while engaging.
      const strafe = Math.sin(time * 1.3 + bot.index * 2.1) * 0.9;
      const nx = group.position.x + Math.cos(bot.yaw) * strafe * dt;
      const nz = group.position.z - Math.sin(bot.yaw) * strafe * dt;
      if (!overlaps(nx, group.position.z)) group.position.x = nx;
      if (!overlaps(group.position.x, nz)) group.position.z = nz;
      bot.walkPhase += dt * 9;
    } else if (bot.state === 'engage') {
      bot.state = bot.holdId ? 'hold' : 'move';
      if (bot.state === 'move' && bot.goal) setPath(bot, bot.goal);
    }

    // Movement.
    if (bot.state === 'move') {
      const arrived = moveAlongPath(bot, dt);
      if (arrived) {
        if (bot.holdId) {
          bot.state = 'hold';
        } else {
          bot.state = 'hold';
          bot.holdId = bot.goal;
        }
      }
    } else if (bot.state === 'hold') {
      bot.sweep += dt * 0.5;
      const base = bot.holdYaw || 0;
      bot.yaw = base + Math.sin(bot.sweep) * 1.0;
      if (bot.heard) {
        faceToward(bot, bot.heard.x, bot.heard.z, dt, 4);
        if (Math.hypot(bot.heard.x - group.position.x, bot.heard.z - group.position.z) < 2) bot.heard = null;
      }
    }

    // Leg swing while walking.
    const swing = Math.sin(bot.walkPhase) * 0.5;
    bot.body.legL.rotation.x = swing;
    bot.body.legR.rotation.x = -swing;
    bot.body.group.rotation.y = bot.yaw;
  }

  return {
    bots,
    hitMeshes,
    spawnRound,
    applyDamage,
    aliveCount(team) {
      return bots.filter((b) => b.alive && b.team === team).length;
    },
    spikeCarrier() {
      return bots.find((b) => b.hasSpike && b.alive) || null;
    },
    giveSpikeToNearest(position) {
      let best = null;
      let bestD = Infinity;
      for (const bot of bots) {
        if (!bot.alive || bot.team !== 'attack') continue;
        const d = Math.hypot(bot.body.group.position.x - position.x, bot.body.group.position.z - position.z);
        if (d < bestD) {
          bestD = d;
          best = bot;
        }
      }
      if (best) {
        best.hasSpike = true;
        best.goalSite = best.goal === 'bSite' ? 'bSite' : 'aSite';
        setPath(best, best.goalSite);
      }
      return best;
    },
    setAttackSite(site) {
      for (const bot of bots) {
        if (bot.team !== 'attack' || !bot.alive) continue;
        bot.goalSite = site;
        if (!bot.hasSpike) {
          bot.goal = site;
          setPath(bot, site);
        }
      }
    },
    step(dt, time, ctx) {
      for (const bot of bots) stepBot(bot, dt, time, ctx);
      ctx.noise.length = 0;
    },
    reset() {
      for (const bot of bots) scene.remove(bot.body.group);
      bots.length = 0;
      hitMeshes.length = 0;
    },
  };
}
