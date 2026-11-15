// DUSKLINE YARD: an original desert relay compound at dusk, built from boxes, cylinders
// and plates. Two bomb sites (A west, B east), a mid lane split by the relay hut, and two
// side lanes. Every solid is a collider for players and bots and a surface bullets stop on.
// Waypoints are a hand-placed graph bots pathfind over with BFS.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const SITES = {
  A: { name: 'A', center: new THREE.Vector3(-15.5, 0, -11), min: new THREE.Vector3(-20, 0, -14.5), max: new THREE.Vector3(-11, 3, -7.5) },
  B: { name: 'B', center: new THREE.Vector3(15.5, 0, -11), min: new THREE.Vector3(11, 0, -14.5), max: new THREE.Vector3(20, 3, -7.5) },
};

export const SPAWNS = {
  attack: [[-4, 14], [0, 14.5], [4, 14], [-2, 12.5], [2, 12.5]],
  defend: [[-4, -14], [0, -14.5], [4, -14], [-2, -12.5], [2, -12.5]],
};

// Waypoint graph: id -> [x, z, [linked ids]]. Bots BFS over it.
export const WAYPOINTS = {
  tSpawn: [0, 14, ['tWest', 'tMid', 'tEast']],
  tWest: [-14, 9, ['tSpawn', 'westMid', 'aApproach']],
  tMid: [0, 9, ['tSpawn', 'midSouth']],
  tEast: [14, 9, ['tSpawn', 'eastMid', 'bApproach']],
  midSouth: [0, 5, ['tMid', 'midDoorL', 'midDoorR']],
  midDoorL: [-5, 0, ['midSouth', 'midNorth', 'westMid']],
  midDoorR: [5, 0, ['midSouth', 'midNorth', 'eastMid']],
  midNorth: [0, -5, ['midDoorL', 'midDoorR', 'ctMid']],
  westMid: [-14, 0, ['tWest', 'midDoorL', 'aApproach']],
  eastMid: [14, 0, ['tEast', 'midDoorR', 'bApproach']],
  aApproach: [-14, -5, ['westMid', 'aSite', 'aHold1']],
  aSite: [-15.5, -11, ['aApproach', 'aHold1', 'aHold2', 'ctSpawn']],
  aHold1: [-18, -8, ['aApproach', 'aSite']],
  aHold2: [-11, -13, ['aSite', 'ctMid']],
  bApproach: [14, -5, ['eastMid', 'bSite', 'bHold1']],
  bSite: [15.5, -11, ['bApproach', 'bHold1', 'bHold2', 'ctSpawn']],
  bHold1: [18, -8, ['bApproach', 'bSite']],
  bHold2: [11, -13, ['bSite', 'ctMid']],
  ctMid: [0, -9, ['midNorth', 'aHold2', 'bHold2', 'ctSpawn']],
  ctSpawn: [0, -14, ['ctMid', 'aSite', 'bSite']],
};

function siteLetterTexture(letter, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  ctx.fillStyle = color;
  ctx.font = 'bold 190px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 138);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.5 : 0.95,
      metalness: 0.02,
    });
  }
  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  function cylinder(rTop, rBottom, h, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, 14), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Ground and perimeter: 46 x 34 m yard, 4.2 m walls, open dusk sky above.
  box(46.4, 0.4, 34.4, 0, -0.2, 0, 'surface');
  box(0.4, 4.2, 34.4, -23.2, 2.1, 0, 'surface');
  box(0.4, 4.2, 34.4, 23.2, 2.1, 0, 'surface');
  box(46.4, 4.2, 0.4, 0, 2.1, -17.2, 'surface');
  box(46.4, 4.2, 0.4, 0, 2.1, 17.2, 'surface');

  // The relay hut splits mid: two passages, left and right, around it.
  box(8, 3.4, 6, 0, 1.7, 0, 'hairline');
  box(8.6, 0.3, 6.6, 0, 3.55, 0, 'rust'); // roof lip
  box(1.2, 2.2, 0.4, -2, 1.1, 3.1, 'sand'); // hut door frame, south face
  box(1.2, 2.2, 0.4, 2, 1.1, 3.1, 'sand');

  // West and east container rows shape the side lanes.
  box(2.4, 2.6, 6, -10, 1.3, 5, 'rust');
  box(2.4, 2.6, 6, -10, 1.3, -5, 'rust');
  box(2.4, 2.6, 6, 10, 1.3, 5, 'rust');
  box(2.4, 2.6, 6, 10, 1.3, -5, 'rust');
  box(2.4, 1.3, 2.4, -10, 3.25, 5, 'sand'); // stacked crate on west container
  box(2.4, 1.3, 2.4, 10, 3.25, -5, 'sand');

  // Site A: raised platform, crates, barrels. Site B: container stack, crates.
  box(9, 0.5, 7, -15.5, 0.25, -11, 'sand');
  box(1.1, 1.1, 1.1, -18.5, 0.55, -13, 'hairline');
  box(1.1, 1.1, 1.1, -18.5, 1.65, -13, 'hairline');
  box(1.1, 1.1, 1.1, -12.5, 0.55, -8.5, 'hairline');
  cylinder(0.55, 0.55, 1.2, -13, 0.6, -13.5, 'rust');
  cylinder(0.55, 0.55, 1.2, -19, 0.6, -9, 'rust');
  box(2.4, 2.6, 5, 18.5, 1.3, -12, 'rust');
  box(2.4, 2.6, 5, 13, 1.3, -14, 'rust');
  box(1.1, 1.1, 1.1, 12.5, 0.55, -8.5, 'hairline');
  box(1.1, 1.1, 1.1, 18, 0.55, -8.5, 'hairline');

  // Scattered crouch cover and barrels across the yard.
  box(1.2, 1.1, 1.2, -6, 0.55, 8, 'hairline');
  box(1.2, 1.1, 1.2, 6, 0.55, 8, 'hairline');
  box(1.2, 1.1, 1.2, -6, 0.55, -8, 'hairline');
  box(1.2, 1.1, 1.2, 6, 0.55, -8, 'hairline');
  box(2.2, 0.9, 1.1, -17, 0.45, 3, 'hairline');
  box(2.2, 0.9, 1.1, 17, 0.45, 3, 'hairline');
  cylinder(0.55, 0.55, 1.2, -3, 0.6, 11, 'rust');
  cylinder(0.55, 0.55, 1.2, 3, 0.6, -11, 'rust');
  box(1.6, 2.4, 1.6, -20.5, 1.2, 12, 'sand'); // spawn cover, west
  box(1.6, 2.4, 1.6, 20.5, 1.2, 12, 'sand'); // spawn cover, east
  box(1.6, 2.4, 1.6, -20.5, 1.2, -12, 'sand');
  box(1.6, 2.4, 1.6, 20.5, 1.2, -12, 'sand');

  // Floating site letters and ground plates, so a site reads at a glance.
  for (const site of Object.values(SITES)) {
    const texture = siteLetterTexture(site.name, PALETTE.accent);
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 3.2),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(site.center.x, 0.52, site.center.z);
    group.add(plate);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.2),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
    );
    sign.position.set(site.center.x, 4.6, site.center.z);
    group.add(sign);
    const lamp = new THREE.PointLight(new THREE.Color(PALETTE.teal), 14, 12);
    lamp.position.set(site.center.x, 3.4, site.center.z);
    group.add(lamp);
  }

  // Dusk light: a low warm sun from the west, a cool sky fill, and teal lamps at the sites.
  const sky = new THREE.HemisphereLight(new THREE.Color('#5a6b8c'), new THREE.Color(PALETTE.surface), 1.25);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ff9a4d'), 3.0);
  sun.position.set(-28, 11, 14);
  sun.target.position.set(6, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#7a86b8'), 0.7);
  fill.position.set(18, 12, -14);
  scene.add(fill);

  return { colliders, shootables, group };
}

export function pointInSite(point, site) {
  return point.x >= site.min.x && point.x <= site.max.x
    && point.z >= site.min.z && point.z <= site.max.z;
}

export function nearestSite(point) {
  let best = null;
  let bestDistance = Infinity;
  for (const site of Object.values(SITES)) {
    const d = Math.hypot(point.x - site.center.x, point.z - site.center.z);
    if (d < bestDistance) {
      bestDistance = d;
      best = site;
    }
  }
  return best;
}
