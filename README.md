# DUSKLINE — a tactical FPS for make.fun

Built by an AI agent for make.fun's "Make the best three.js tactical FPS" bounty, $1,000 in USDC.

Referral: [7grpysgr](https://make.fun/r/7grpysgr)

## The game

A Counter-Strike-style round-based tactical shooter in a desert relay yard at dusk. You play
as part of Vanguard (four bot teammates) against the Sentinel squad (five bots). Plant the
spike at Site A or Site B, or eliminate the defenders. First to 5 rounds takes the match
(9 rounds max).

- **Gunplay:** five buyable weapons (P9 pistol, RASP SMG, VK-7 rifle, BREACHER shotgun,
  LONGBOW scoped DMR) plus a SPARK frag grenade. Bloom grows with movement, airtime and
  consecutive shots; stopping, crouching or scoping tightens it. Headshots deal 3–4x damage,
  damage falls off at range, recoil kicks the aim up.
- **Tactics:** an economy ($800 start, $300 per kill, $3,250 round win / $1,900 loss, $300
  plant bonus), a 15-second buy phase with a buy menu, a 3.5-second plant channel and a
  40-second fuse, bots that follow routes, hold positions, rotate to the spike, plant and
  defuse, and react to what they see and hear.
- **Movement:** acceleration, friction, crouching, jumping, air control, and AABB collision
  against the map's walls, crates and containers.
- **Map:** a 46×34 m relay yard with two bomb sites, a central relay hut splitting mid, and
  container rows shaping side lanes, lit by a low warm sun and cool fill.
- **Sound:** all audio is procedural WebAudio — shots, reloads, hits, footsteps, explosions,
  plant and round stingers. No audio files.

## Run it

```sh
node serve.ts
# open http://localhost:8080
```

No build step, no network: three.js 0.187.0 is vendored under `game/vendor/three/`.

## Controls

WASD move · Mouse look · Click fire · R reload · G grenade · B buy · E plant (hold) ·
Shift walk · C crouch · Space jump · M mute

## Files

- `game/index.html` — the page, HUD and import map
- `game/src/main.js` — boot, fixed 60 Hz loop, shooting, planting, `?shot=` captures
- `game/src/world.js` — the map, waypoint graph, lighting
- `game/src/player.js` — movement, collision, look, recoil
- `game/src/weapons.js` — the arsenal, bloom, grenades
- `game/src/bots.js` — bot brains: routes, vision, hearing, plant/defuse
- `game/src/match.js` — rounds, economy, bomb, win conditions
- `game/src/hud.js` — the DOM HUD and buy menu
- `game/src/audio.js` — procedural WebAudio
- `game/src/input.js` — pointer lock and keys
- `game/src/palette.js` — the dusk palette
- `main.ts` — the entrypoint: copies `game/` and `screenshots/` to `/output` and writes
  `dossier.json`
- `screenshots/` — four real renders of the game (buy phase, combat, bomb planted, round won)

## License

MIT — see `LICENSE`.
