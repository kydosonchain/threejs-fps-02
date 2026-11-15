// The match: one place for all match state. Phases run buy (15 s) -> live (100 s) ->
// round end (4 s) -> next round, first to 5 rounds takes the match (9 rounds max).
// Money follows Counter-Strike's shape: kills pay, the round pays, planting pays.
// The bomb is the objective: attackers plant at A or B, defenders defuse or run the clock.
import { SITES } from './world.js';

export const BUY_SECONDS = 15;
export const ROUND_SECONDS = 100;
export const ROUND_END_SECONDS = 4;
export const BOMB_FUSE = 40;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;
export const REWARD_KILL = 300;
export const REWARD_WIN = 3250;
export const REWARD_LOSS = 1900;
export const REWARD_PLANT = 300;

export function createMatch(onEvent) {
  const state = {
    phase: 'buy',
    round: 1,
    wins: { attack: 0, defend: 0 },
    timer: BUY_SECONDS,
    money: 800,
    kills: 0,
    deaths: 0,
    bomb: { planted: false, site: null, position: null, fuseLeft: 0 },
    spike: { carrier: 'player', droppedAt: null },
    over: false,
  };

  function phaseTimer() {
    return state.phase === 'buy' ? BUY_SECONDS : state.phase === 'live' ? ROUND_SECONDS : ROUND_END_SECONDS;
  }

  function endRound(winner, reason) {
    if (state.phase !== 'live') return;
    state.phase = 'roundEnd';
    state.timer = ROUND_END_SECONDS;
    state.wins[winner] += 1;
    state.money += winner === 'attack' ? REWARD_WIN : REWARD_LOSS;
    onEvent({ type: 'roundEnd', winner, reason, round: state.round, wins: { ...state.wins } });
    if (state.wins[winner] >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
      state.over = true;
    }
  }

  return {
    state,
    startMatch() {
      state.phase = 'buy';
      state.round = 1;
      state.wins = { attack: 0, defend: 0 };
      state.timer = BUY_SECONDS;
      state.money = 800;
      state.kills = 0;
      state.deaths = 0;
      state.bomb = { planted: false, site: null, position: null, fuseLeft: 0 };
      state.spike = { carrier: 'player', droppedAt: null };
      state.over = false;
    },
    startRound() {
      state.phase = 'buy';
      state.timer = BUY_SECONDS;
      state.bomb = { planted: false, site: null, position: null, fuseLeft: 0 };
      state.spike = { carrier: 'player', droppedAt: null };
      onEvent({ type: 'roundStart', round: state.round });
    },
    beginLive() {
      if (state.phase !== 'buy') return;
      state.phase = 'live';
      state.timer = ROUND_SECONDS;
      onEvent({ type: 'liveStart', round: state.round });
    },
    spend(amount) {
      if (state.money < amount) return false;
      state.money -= amount;
      return true;
    },
    earn(amount) {
      state.money += amount;
    },
    addKill() {
      state.kills += 1;
      state.money += REWARD_KILL;
    },
    addDeath() {
      state.deaths += 1;
    },
    dropSpike(position) {
      state.spike = { carrier: null, droppedAt: position.clone() };
    },
    giveSpikeToBot(bot) {
      state.spike = { carrier: bot, droppedAt: null };
    },
    plantBomb(siteName, position, planter) {
      if (state.bomb.planted || state.phase !== 'live') return false;
      const site = SITES[siteName];
      state.bomb = { planted: true, site: siteName, position: position.clone(), fuseLeft: BOMB_FUSE };
      state.money += REWARD_PLANT;
      onEvent({ type: 'bombPlanted', site: siteName, position: position.clone(), planter });
      return true;
    },
    defuseBomb(defuser) {
      if (!state.bomb.planted) return;
      state.bomb.planted = false;
      onEvent({ type: 'bombDefused', defuser });
      endRound('defend', 'defused');
    },
    step(dt, ctx) {
      if (state.phase === 'buy') {
        state.timer -= dt;
        if (state.timer <= 0) this.beginLive();
        return;
      }
      if (state.phase === 'roundEnd') {
        state.timer -= dt;
        if (state.timer <= 0) {
          if (state.over) {
            state.phase = 'matchEnd';
            onEvent({ type: 'matchEnd', winner: state.wins.attack > state.wins.defend ? 'attack' : 'defend', wins: { ...state.wins } });
          } else {
            state.round += 1;
            this.startRound();
          }
        }
        return;
      }
      if (state.phase !== 'live') return;
      state.timer -= dt;
      if (state.bomb.planted) {
        state.bomb.fuseLeft -= dt;
        if (state.bomb.fuseLeft <= 0) {
          state.bomb.planted = false;
          onEvent({ type: 'bombExploded', site: state.bomb.site });
          endRound('attack', 'detonation');
          return;
        }
      } else if (state.timer <= 0) {
        endRound('defend', 'time');
        return;
      }
      if (ctx.attackersAlive === 0) {
        endRound('defend', 'eliminated');
        return;
      }
      if (ctx.defendersAlive === 0) {
        endRound('attack', 'eliminated');
      }
    },
    phaseName() {
      return state.phase;
    },
  };
}
