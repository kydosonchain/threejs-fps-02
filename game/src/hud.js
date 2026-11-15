// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, score, killfeed, the
// buy menu and every overlay panel. It never touches the simulation; main.js pushes numbers
// in and reads the buy and play callbacks out.
import { WEAPONS, GRENADE } from './weapons.js';

const BUY_KEYS = ['pistol', 'smg', 'rifle', 'shotgun', 'sniper'];

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const healthFill = $('health-fill');
  const healthValue = $('health-value');
  const moneyValue = $('money-value');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const grenadeCount = $('grenade-count');
  const timerValue = $('timer-value');
  const scoreValue = $('score-value');
  const roundValue = $('round-value');
  const killfeed = $('killfeed');
  const objective = $('objective');
  const plantWrap = $('plant-wrap');
  const plantFill = $('plant-fill');
  const plantLabel = $('plant-label');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const damage = $('damage');
  const overlay = $('overlay');
  const overlayTitle = $('overlay-title');
  const overlayCopy = $('overlay-copy');
  const playButton = $('play');
  const buyMenu = $('buy-menu');
  const buyGrid = $('buy-grid');
  const buyMoney = $('buy-money');
  const buyClose = $('buy-close');
  let hitTimer = 0;
  let damageTimer = 0;
  let lastMag = -1;
  let lastReserve = -1;
  let lastWeapon = '';
  let lastGrenades = -1;
  let lastHealth = -1;
  let lastMoney = -1;
  let lastTimer = -1;
  let lastScore = '';

  function formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  return {
    setHealth(hp) {
      const value = Math.max(0, Math.round(hp));
      if (value === lastHealth) return;
      lastHealth = value;
      healthFill.style.width = `${value}%`;
      healthFill.classList.toggle('low', value <= 30);
      healthValue.textContent = String(value);
    },
    setAmmo(mag, reserve, name, grenades) {
      if (mag !== lastMag || reserve !== lastReserve) {
        lastMag = mag;
        lastReserve = reserve;
        ammoMag.textContent = String(mag);
        ammoReserve.textContent = `/ ${reserve}`;
        $('ammo').classList.toggle('empty', mag === 0);
      }
      if (name !== lastWeapon) {
        lastWeapon = name;
        weaponName.textContent = name;
      }
      if (grenades !== lastGrenades) {
        lastGrenades = grenades;
        grenadeCount.textContent = `◉ ${grenades}`;
      }
    },
    setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      moneyValue.textContent = `$${value}`;
    },
    setTimer(seconds, phase) {
      const text = phase === 'buy' ? `BUY ${formatTime(seconds)}` : formatTime(seconds);
      if (text === lastTimer) return;
      lastTimer = text;
      timerValue.textContent = text;
      timerValue.classList.toggle('buy', phase === 'buy');
    },
    setScore(attackWins, defendWins, round) {
      const text = `${attackWins} — ${defendWins}`;
      if (text === lastScore) return;
      lastScore = text;
      scoreValue.textContent = text;
      roundValue.textContent = `ROUND ${round} / 9`;
    },
    setCrosshairGap(px) {
      crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    hitMarker(killed) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), 110);
    },
    damageFlash() {
      damage.classList.add('on');
      clearTimeout(damageTimer);
      damageTimer = setTimeout(() => damage.classList.remove('on'), 220);
    },
    killfeedAdd(text, friendly) {
      const entry = document.createElement('div');
      entry.className = `feed-entry${friendly ? ' friendly' : ''}`;
      entry.textContent = text;
      killfeed.prepend(entry);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => entry.classList.add('fade'), 4200);
      setTimeout(() => entry.remove(), 5000);
    },
    setObjective(text) {
      objective.textContent = text;
    },
    setPlantProgress(progress, label) {
      if (progress === null) {
        plantWrap.hidden = true;
        return;
      }
      plantWrap.hidden = false;
      plantFill.style.width = `${Math.round(progress * 100)}%`;
      plantLabel.textContent = label;
    },
    showBanner(title, sub, good) {
      bannerTitle.textContent = title;
      bannerSub.textContent = sub;
      banner.classList.toggle('good', good === true);
      banner.classList.toggle('bad', good === false);
      banner.hidden = false;
      clearTimeout(banner._timer);
      banner._timer = setTimeout(() => {
        banner.hidden = true;
      }, 3800);
    },
    hideBanner() {
      banner.hidden = true;
    },
    showOverlay(mode, data) {
      if (mode === 'start') {
        overlayTitle.textContent = 'DUSKLINE';
        overlayCopy.textContent = 'A desert relay yard at dusk. Plant the spike at A or B, or wipe the Sentinel squad. First to 5 rounds takes the match.';
        playButton.textContent = 'Click to play';
      } else if (mode === 'paused') {
        overlayTitle.textContent = 'DUSKLINE';
        overlayCopy.textContent = 'Paused. Click to resume.';
        playButton.textContent = 'Click to resume';
      } else if (mode === 'dead') {
        overlayTitle.textContent = 'You are down';
        overlayCopy.textContent = 'Your squad fights on. Next round starts soon.';
        playButton.textContent = 'Spectate';
      } else if (mode === 'matchEnd') {
        overlayTitle.textContent = data.winner === 'attack' ? 'VANGUARD WINS' : 'SENTINEL WINS';
        overlayCopy.textContent = `Final score ${data.wins.attack} — ${data.wins.defend}. You scored ${data.kills} eliminations.`;
        playButton.textContent = 'Play again';
      }
      overlay.hidden = false;
      playButton.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      playButton.addEventListener('click', handler);
    },
    buildBuyMenu(onBuy) {
      buyGrid.innerHTML = '';
      const items = BUY_KEYS.map((id) => ({ id, ...WEAPONS[id] }));
      items.push({ id: 'grenade', ...GRENADE, mag: null });
      items.forEach((item, index) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'buy-card';
        card.dataset.id = item.id;
        card.innerHTML = `<b>${index + 1} · ${item.name}</b><span>${item.mag === null ? 'Frag grenade' : `${item.damage} dmg · ${item.mag} rounds`}</span><i>$${item.price}</i>`;
        card.addEventListener('click', () => onBuy(item.id));
        buyGrid.appendChild(card);
      });
    },
    refreshBuyMenu(money, owned) {
      buyMoney.textContent = `$${money}`;
      for (const card of buyGrid.children) {
        const id = card.dataset.id;
        const price = id === 'grenade' ? GRENADE.price : WEAPONS[id].price;
        card.classList.toggle('owned', Boolean(owned[id]));
        card.classList.toggle('poor', money < price && !owned[id]);
      }
    },
    showBuyMenu() {
      buyMenu.hidden = false;
    },
    hideBuyMenu() {
      buyMenu.hidden = true;
    },
    onBuyClose(handler) {
      buyClose.addEventListener('click', handler);
    },
  };
}
