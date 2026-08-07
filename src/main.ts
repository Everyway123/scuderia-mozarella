// Оболонка застосунку: меню → штаб → квала → гонка → результат → штаб.
//
// Атрибути data-test навмисно стабільні: за них тримаються E2E-сценарії,
// і ламати їх косметичними правками не можна.

import './style.css';
import { DRIVERS_2026, driversOfTeam } from './data/drivers2026.ts';
import { TEAMS_2026 } from './data/teams2026.ts';
import { TRACKS_2026, TRACK_BY_ID } from './data/tracks2026.ts';
import { RaceView } from './race/RaceView.ts';
import { PART_BY_ID } from './season/parts.ts';
import {
  CHIPS,
  canUseChip,
  clearSave,
  computeRp,
  currentTrack,
  driverStandings,
  isSeasonOver,
  load,
  newSeason,
  offersFor,
  raceSeed,
  recordRace,
  save,
  teamsForRound,
  teamStandings,
  useChip,
  type ChipId,
  type SeasonState,
} from './season/season.ts';
import { COMPOUNDS } from './sim/constants.ts';
import { gridFromQuali, runQualifying, type QualiResult } from './sim/qualifying.ts';
import { fmt, type Race } from './sim/raceEngine.ts';
import { Rng } from './sim/rng.ts';
import type { RaceLength, Team } from './sim/types.ts';

const app = document.querySelector<HTMLDivElement>('#app')!;
let view: RaceView | null = null;
let season: SeasonState | null = null;
let quick: { trackId: string; length: RaceLength; seed: number; teamId: string } | null = null;

function clearView(): void {
  view?.destroy();
  view = null;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

// ---------------------------------------------------------------- МЕНЮ

function showMenu(): void {
  clearView();
  season = null;
  quick = null;
  const saved = load();

  app.innerHTML = `
    <div class="setup" data-test="menu">
      <h1>🧀 SCUDERIA MOZARELLA</h1>
      <p class="sub">F1-менеджер, сезон 2026. Обери команду і веди її з пітволу.</p>

      ${
        saved
          ? `<button class="btn primary big" data-test="continue">▶ Продовжити сезон · етап ${Math.min(saved.round, 24)}/24</button>
             <button class="btn big ghost" data-test="wipe">Почати заново</button>`
          : ''
      }

      <label class="field">
        <span>Команда</span>
        <select id="teamSel" data-test="team-select">
          ${TEAMS_2026.map((t) => {
            const ds = driversOfTeam(t.id)
              .map((d) => d.short)
              .join(' / ');
            return `<option value="${t.id}">${esc(t.name)} — ${ds}</option>`;
          }).join('')}
        </select>
      </label>
      <p class="hint" id="teamHint"></p>

      <label class="field">
        <span>Довжина гонки</span>
        <div class="seg" id="lenSeg">
          <button data-len="25" class="on">25% · ~3 хв</button>
          <button data-len="50">50% · ~7 хв</button>
          <button data-len="100">100% · ~14 хв</button>
        </div>
      </label>

      <button class="btn primary big" data-test="new-season">🏆 НОВИЙ СЕЗОН</button>
      <button class="btn big ghost" data-test="quick-race">⚡ Швидка гонка</button>
    </div>
  `;

  let length: RaceLength = 25;
  const teamSel = app.querySelector<HTMLSelectElement>('#teamSel')!;
  const hint = app.querySelector('#teamHint')!;

  const updateHint = () => {
    const team = TEAMS_2026.find((t) => t.id === teamSel.value)!;
    const rank = [...TEAMS_2026].sort((a, b) => a.pace - b.pace).findIndex((t) => t.id === team.id) + 1;
    const verdict =
      rank <= 2
        ? 'Топ грида. Від тебе чекають перемог — помилка коштує чемпіонату.'
        : rank <= 5
          ? 'Боротьба за подіум. Стратегія вирішує більше за темп.'
          : rank <= 8
            ? 'Середняк. Очки треба вигризати вікном піту й погодою.'
            : 'Аутсайдер. Кожна відіграна позиція — подія. Найчесніший тест стратегії.';
    hint.textContent = `${rank}-й темп грида (+${team.pace.toFixed(2)} с/коло). ${verdict}`;
  };

  teamSel.addEventListener('change', updateHint);
  updateHint();

  const seg = app.querySelector('#lenSeg')!;
  seg.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    seg.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
    btn.classList.add('on');
    length = Number(btn.dataset.len) as RaceLength;
  });

  app.querySelector('[data-test="new-season"]')!.addEventListener('click', () => {
    season = newSeason(teamSel.value, length, Math.floor(Math.random() * 1e6) + 1);
    save(season);
    showHub();
  });

  app.querySelector('[data-test="quick-race"]')!.addEventListener('click', () => {
    quick = { trackId: TRACKS_2026[0]!.id, length, seed: 2026, teamId: teamSel.value };
    showQuickSetup();
  });

  app.querySelector('[data-test="continue"]')?.addEventListener('click', () => {
    season = saved;
    showHub();
  });

  app.querySelector('[data-test="wipe"]')?.addEventListener('click', () => {
    clearSave();
    showMenu();
  });
}

// -------------------------------------------------------- ШВИДКА ГОНКА

function showQuickSetup(): void {
  clearView();
  const q = quick!;
  app.innerHTML = `
    <div class="setup" data-test="quick-setup">
      <h1>⚡ Швидка гонка</h1>
      <p class="sub">Один етап без сезону й збереження.</p>
      <label class="field">
        <span>Етап</span>
        <select id="trackSel" data-test="track-select">
          ${TRACKS_2026.map((t) => `<option value="${t.id}">${t.round}. ${esc(t.name)} — ${esc(t.country)}</option>`).join('')}
        </select>
      </label>
      <label class="field"><span>Seed</span>
        <input id="seedInput" type="number" value="${q.seed}" data-test="seed-input" /></label>
      <button class="btn primary big" data-test="go">🏁 НА СТАРТ</button>
      <button class="btn big ghost" data-test="back">← Меню</button>
    </div>`;

  app.querySelector('[data-test="go"]')!.addEventListener('click', () => {
    q.trackId = app.querySelector<HTMLSelectElement>('#trackSel')!.value;
    q.seed = Number(app.querySelector<HTMLInputElement>('#seedInput')!.value) || 2026;
    startRace(q.trackId, q.length, q.seed, TEAMS_2026, q.teamId, null);
  });
  app.querySelector('[data-test="back"]')!.addEventListener('click', showMenu);
}

// --------------------------------------------------------- ШТАБ СЕЗОНУ

function showHub(): void {
  clearView();
  const s = season!;
  save(s);

  if (isSeasonOver(s)) return showSeasonEnd();

  const track = currentTrack(s);
  const team = TEAMS_2026.find((t) => t.id === s.teamId)!;
  const mine = driversOfTeam(s.teamId);
  const tStand = teamStandings(s);
  const myPos = tStand.findIndex((r) => r.id === s.teamId) + 1;
  const offers = offersFor(s);
  const isHome = s.homeTracks.includes(track.id);

  app.innerHTML = `
    <div class="hub" data-test="hub">
      <header class="hub-head" style="--team:${team.color}">
        <div><b>${esc(team.name)}</b><span>сезон 2026 · ${myPos}-е місце в кубку конструкторів</span></div>
        <button class="btn ghost" data-test="to-menu">← Меню</button>
      </header>

      <div class="hub-grid">
        <section class="card next-race">
          <h3>Етап ${s.round} з 24 ${isHome ? '<span class="home-badge" data-test="home-badge">🏠 фірмова траса</span>' : ''}</h3>
          <div class="track-name">${esc(track.name)}</div>
          <div class="track-meta">${esc(track.country)} · ${Math.max(5, Math.round((track.laps * s.length) / 100))} кіл (${s.length}%)</div>
          <ul class="track-facts">
            <li>Знос гуми <b>${track.tyreWear >= 1.2 ? 'високий' : track.tyreWear >= 0.95 ? 'середній' : 'низький'}</b></li>
            <li>Обгін <b>${track.overtaking >= 0.19 ? 'реальний' : track.overtaking >= 0.12 ? 'важкий' : 'майже неможливий'}</b></li>
            <li>Втрата на піт <b>${track.pitLoss} с</b></li>
            <li>Шанс дощу <b>${Math.round(track.rainChance * 100)}%</b></li>
            <li>Сейфті-кар <b>${Math.round(track.safetyCar * 100)}%</b></li>
          </ul>
          <button class="btn primary big" data-test="start-race">🏁 НА КВАЛУ</button>
        </section>

        <section class="card">
          <h3>Ставка на етап</h3>
          <p class="card-note">Хто з двох привезе результат? Його очки рахуються подвійно.
          Сходить або лишиться поза очками — RP за нього віднімається.
          Після квали ставку можна перерішити один раз.</p>
          <div class="bet" data-test="bet">
            ${mine
              .map(
                (d) =>
                  `<button class="bet-opt${s.nomination === d.id ? ' on' : ''}" data-bet="${d.id}">
                     <b>${esc(d.name)}</b><span>#${d.number}</span></button>`,
              )
              .join('')}
          </div>
        </section>

        <section class="card">
          <h3>Розробка · <span class="rp" data-test="rp">${s.rp} RP</span></h3>
          <p class="card-note">Три пропозиції на етап. Кожна деталь — компроміс,
          а не просто поліпшення.</p>
          <div class="offers" data-test="offers">
            ${offers
              .map((id) => {
                const p = PART_BY_ID.get(id)!;
                const afford = s.rp >= p.cost;
                return `<button class="offer${afford ? '' : ' poor'}" data-part="${id}" ${afford ? '' : 'disabled'}>
                  <div class="offer-name">${esc(p.name)}</div>
                  <div class="offer-note">${esc(p.note)}</div>
                  <div class="offer-cost">${p.cost} RP</div>
                </button>`;
              })
              .join('')}
            ${offers.length === 0 ? '<p class="card-note">Уся колода вже на боліді.</p>' : ''}
          </div>
          <div class="installed" data-test="installed">
            ${
              s.parts.length
                ? s.parts
                    .map((id) => `<span class="pill">${esc(PART_BY_ID.get(id)?.name ?? id)}</span>`)
                    .join('')
                : '<span class="card-note">Деталей ще немає</span>'
            }
          </div>
        </section>

        <section class="card">
          <h3>Козирі сезону</h3>
          <p class="card-note">По одному разу за сезон. Питання не «чи», а «коли».</p>
          <div class="chips" data-test="chips">
            ${CHIPS.map((c) => {
              const used = s.chipsUsed.includes(c.id);
              const armed = s.armedChip === c.id;
              const can = canUseChip(s, c.id);
              return `<button class="chip-card${used ? ' used' : ''}${armed ? ' armed' : ''}"
                data-chip="${c.id}" data-test="chip-${c.id}" ${used || (!can && !armed) ? 'disabled' : ''}>
                <b>${esc(c.name)}</b><span>${esc(c.note)}</span>
                ${used ? '<i>використано</i>' : armed ? '<i>зведено на цей етап</i>' : ''}
              </button>`;
            }).join('')}
          </div>
        </section>

        <section class="card">
          <h3>Пілоти</h3>
          <ol class="stand" data-test="driver-standings">
            ${driverStandings(s)
              .slice(0, 10)
              .map(
                (r, i) =>
                  `<li class="${r.isPlayer ? 'mine' : ''}"><span class="n">${i + 1}</span><span class="dot" style="background:${r.color}"></span>${esc(r.name)}<b>${r.points}</b></li>`,
              )
              .join('')}
          </ol>
        </section>

        <section class="card">
          <h3>Конструктори</h3>
          <ol class="stand" data-test="team-standings">
            ${tStand
              .map(
                (r, i) =>
                  `<li class="${r.isPlayer ? 'mine' : ''}"><span class="n">${i + 1}</span><span class="dot" style="background:${r.color}"></span>${esc(r.name)}<b>${r.points}</b></li>`,
              )
              .join('')}
          </ol>
        </section>
      </div>
    </div>`;

  app.querySelector('[data-test="to-menu"]')!.addEventListener('click', showMenu);
  app.querySelector('[data-test="start-race"]')!.addEventListener('click', () => showQuali());

  for (const btn of app.querySelectorAll<HTMLButtonElement>('[data-bet]')) {
    btn.addEventListener('click', () => {
      s.nomination = btn.dataset.bet!;
      save(s);
      showHub();
    });
  }

  for (const btn of app.querySelectorAll<HTMLButtonElement>('[data-part]')) {
    btn.addEventListener('click', () => {
      const part = PART_BY_ID.get(btn.dataset.part!);
      if (!part || s.rp < part.cost || s.parts.includes(part.id)) return;
      s.rp -= part.cost;
      s.parts.push(part.id);
      save(s);
      showHub();
    });
  }

  for (const btn of app.querySelectorAll<HTMLButtonElement>('[data-chip]')) {
    btn.addEventListener('click', () => {
      if (useChip(s, btn.dataset.chip as ChipId)) {
        save(s);
        showHub();
      }
    });
  }
}

function showSeasonEnd(): void {
  const s = season!;
  const tStand = teamStandings(s);
  const dStand = driverStandings(s);
  const pos = tStand.findIndex((r) => r.id === s.teamId) + 1;
  const champion = dStand[0]!;
  const myBest = Math.min(...s.history.map((r) => r.bestPosition || 99));
  const totalPoints = s.history.reduce((a, r) => a + r.pointsScored, 0);
  const totalRp = s.history.reduce((a, r) => a + r.rpGained, 0);
  const betsWon = s.history.filter((r) => r.betPaid).length;
  const homes = s.homeTracks
    .map((id) => TRACK_BY_ID.get(id)?.name ?? id)
    .join(', ');

  const row = (r: { name: string; color: string; points: number; isPlayer: boolean }, i: number) =>
    `<tr class="${r.isPlayer ? 'mine' : ''}">
      <td class="pos">${i + 1}</td>
      <td><span class="dot" style="background:${r.color}"></span>${esc(r.name)}</td>
      <td class="pts">${r.points}</td>
    </tr>`;

  app.innerHTML = `
    <div class="setup wide" data-test="season-end">
      <h1>🏆 Сезон завершено</h1>
      <p class="sub"><b>${esc(champion.name)}</b> — чемпіон світу.
      Кубок конструкторів — <b>${esc(tStand[0]!.name)}</b>.</p>

      <p class="results-sum" data-test="season-summary">
        Твій сезон: <b>${pos}-е місце</b> в кубку конструкторів, <b>${totalPoints}</b> очок за 24 етапи.
        Найкращий фініш — <b>${myBest === 99 ? '—' : `P${myBest}`}</b>.
        Зароблено <b>${totalRp} RP</b>, вдалих ставок — <b>${betsWon}/24</b>.
        ${s.homeTracks.length > 0 ? `Фірмові траси: <b>${esc(homes)}</b> — вони твої й наступного сезону.` : 'Фірмових трас поки немає — перша перемога зробить трасу твоєю назавжди.'}
      </p>

      <div class="finale-grid">
        <div>
          <h3 class="finale-h">Пілоти · топ-10</h3>
          <table class="grid-table"><tbody>
            ${dStand.slice(0, 10).map(row).join('')}
          </tbody></table>
        </div>
        <div>
          <h3 class="finale-h">Конструктори</h3>
          <table class="grid-table"><tbody>
            ${tStand.map(row).join('')}
          </tbody></table>
        </div>
      </div>

      <div class="finale-actions">
        <button class="btn primary big" data-test="restart-carry">Новий сезон — з фірмовими трасами</button>
        <button class="btn" data-test="restart">Почати з чистого аркуша</button>
      </div>
    </div>`;

  // Кар'єра: фірмові траси — це пам'ять, яку сезон передає наступному
  app.querySelector('[data-test="restart-carry"]')!.addEventListener('click', () => {
    const next = newSeason(s.teamId, s.length, Math.floor(Math.random() * 1e6) + 1);
    next.homeTracks = [...s.homeTracks];
    season = next;
    save(next);
    showHub();
  });
  app.querySelector('[data-test="restart"]')!.addEventListener('click', () => {
    clearSave();
    showMenu();
  });
}

// --------------------------------------------------------------- КВАЛА

/**
 * Екран квали. Тут гравець уперше бачить решітку — і саме тому може один раз
 * перерішити ставку. Це механіка Final Fix із Fantasy: інформація прийшла,
 * рішення оновлюється.
 */
function showQuali(): void {
  clearView();
  const s = season!;
  const track = currentTrack(s);
  const teams = teamsForRound(s);
  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const seed = raceSeed(s);
  const quali = runQualifying(track, DRIVERS_2026, teamMap, new Rng(seed ^ 0x51ed));
  const mine = driversOfTeam(s.teamId).map((d) => d.id);

  const render = () => {
    app.innerHTML = `
      <div class="setup wide" data-test="quali">
        <h1>⏱ Квала · ${esc(track.name)}</h1>
        <p class="sub">Решітка визначена. Ставку на етап можна перерішити ${s.betFixed ? '— вже використано' : 'один раз'}.</p>

        <table class="grid-table" data-test="grid">
          <tbody>
            ${quali
              .slice(0, 22)
              .map((q: QualiResult, i) => {
                const d = DRIVERS_2026.find((x) => x.id === q.driverId)!;
                const t = teamMap.get(d.teamId)!;
                const isMine = mine.includes(q.driverId);
                return `<tr class="${isMine ? 'mine' : ''}">
                  <td class="pos">${i + 1}</td>
                  <td><span class="dot" style="background:${t.color}"></span>${esc(d.name)}</td>
                  <td class="dim">${t.short}</td>
                  <td class="mono">${fmt(q.time)}${q.spoiled ? ' ⚠' : ''}</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>

        <div class="field">
          <span>Лідер етапу</span>
          <div class="bet" data-test="bet-quali">
            ${driversOfTeam(s.teamId)
              .map((d) => {
                const gridPos = quali.findIndex((q) => q.driverId === d.id) + 1;
                return `<button class="bet-opt${s.nomination === d.id ? ' on' : ''}"
                  data-bet="${d.id}" ${s.betFixed && s.nomination !== d.id ? 'disabled' : ''}>
                  <b>${esc(d.name)}</b><span>стартує ${gridPos}-м</span></button>`;
              })
              .join('')}
          </div>
        </div>

        <button class="btn primary big" data-test="to-race">🏁 У ГОНКУ</button>
      </div>`;

    for (const btn of app.querySelectorAll<HTMLButtonElement>('[data-bet]')) {
      btn.addEventListener('click', () => {
        if (s.nomination === btn.dataset.bet) return;
        s.nomination = btn.dataset.bet!;
        s.betFixed = true;
        save(s);
        render();
      });
    }
    app.querySelector('[data-test="to-race"]')!.addEventListener('click', () => {
      startRace(track.id, s.length, seed, teams, s.teamId, s, gridFromQuali(quali));
    });
  };

  render();
}

// -------------------------------------------------------------- ГОНКА

function startRace(
  trackId: string,
  length: RaceLength,
  seed: number,
  teams: Team[],
  playerTeamId: string,
  seasonState: SeasonState | null,
  grid?: string[],
): void {
  const track = TRACK_BY_ID.get(trackId)!;
  let startGrid = grid;
  if (!startGrid) {
    const teamMap = new Map(teams.map((t) => [t.id, t]));
    startGrid = gridFromQuali(runQualifying(track, DRIVERS_2026, teamMap, new Rng(seed ^ 0x51ed)));
  }

  clearView();
  view = new RaceView(app, {
    track,
    drivers: DRIVERS_2026,
    teams,
    length,
    seed,
    grid: startGrid,
    playerTeamId,
    onFinish: (race) => showResults(race, seasonState, trackId),
  });
}

function showResults(race: Race, seasonState: SeasonState | null, trackId: string): void {
  const classification = race.classification();
  let summary = '';

  if (seasonState) {
    const mine = classification.filter((c) => c.team.id === seasonState.teamId);
    const preview = computeRp(seasonState, mine);
    const nominated = mine.find((c) => c.driver.id === seasonState.nomination);
    const wasHome = seasonState.homeTracks.includes(trackId);
    const rec = recordRace(seasonState, classification, trackId);
    save(seasonState);

    const betLine = nominated
      ? nominated.status === 'dnf'
        ? `Ставка на ${nominated.driver.short} згоріла — схід.`
        : nominated.points === 0
          ? `Ставка на ${nominated.driver.short} не зіграла — поза очками.`
          : `Ставка на ${nominated.driver.short} зіграла: ${nominated.points} очок подвійно.`
      : '';
    const newHome =
      !wasHome && seasonState.homeTracks.includes(trackId)
        ? ' <b>Перемога! Траса стала фірмовою.</b>'
        : '';

    summary = `<p class="results-sum" data-test="results-summary">
      Найкраща позиція <b>P${rec.bestPosition || '—'}</b>, очок <b>${rec.pointsScored}</b>.
      ${betLine}${newHome}<br>
      RP: база ${preview.base} + очки ${preview.fromPoints} + відіграні позиції
      ${preview.fromGained} + ставка ${preview.fromBet >= 0 ? '+' : ''}${preview.fromBet}
      ${preview.chipMultiplier > 1 ? ` × козир ${preview.chipMultiplier}` : ''}
      = <b>${rec.rp.total} RP</b>
    </p>`;
  }

  const rows = classification
    .map((c) => {
      const gap =
        c.status === 'dnf'
          ? `<i>сход — ${esc(c.dnfReason ?? '')}</i>`
          : c.position === 1
            ? fmt(c.totalTime)
            : `+${(c.gap ?? 0).toFixed(3)}`;
      const comps = c.compounds
        .map(
          (id) =>
            `<span class="pill" style="color:${COMPOUNDS[id].color};border-color:${COMPOUNDS[id].color}">${COMPOUNDS[id].label}</span>`,
        )
        .join('');
      const mine = seasonState ? c.team.id === seasonState.teamId : false;
      const gainTag =
        c.status === 'dnf'
          ? ''
          : c.gained > 0
            ? `<span class="gain up">+${c.gained}</span>`
            : c.gained < 0
              ? `<span class="gain down">${c.gained}</span>`
              : '<span class="gain">=</span>';
      const pen = c.penalty > 0 ? `<span class="pen" title="${esc(c.penaltyReason ?? '')}">+${c.penalty}с</span>` : '';
      return `<tr class="${c.status === 'dnf' ? 'out' : ''}${mine ? ' mine' : ''}">
        <td class="pos">${c.status === 'dnf' ? '—' : c.position}</td>
        <td><span class="dot" style="background:${c.team.color}"></span>${esc(c.driver.name)}</td>
        <td class="dim">${c.team.short}</td>
        <td>${gainTag}</td>
        <td class="mono">${gap} ${pen}</td>
        <td>${c.stops}</td>
        <td>${comps}</td>
        <td class="pts">${c.points || ''}${c.fastestLap ? ' ⚡' : ''}</td>
      </tr>`;
    })
    .join('');

  // Розбір стратегії: гонка стає уроком, а не лише результатом. Це та сама
  // математика планувальника й моделі кола, з якою гравець боровся, — і розбір
  // бачить гонку ЦІЛКОМ: сейфті-кари, дощ, сходи, — а не лише арифметику стінтів.
  let debrief = '';
  const myCars = race.playerCars();
  if (myCars.length > 0) {
    // Контекст гонки — з реальних подій симуляції
    const events = race.state.events;
    const scCount = events.filter((e) => e.kind === 'safety-car').length;
    const wasWet = events.some((e) => e.kind === 'weather');
    const dnfCount = events.filter((e) => e.kind === 'dnf').length;
    const ctx = [
      scCount > 0 ? `сейфті-кар ×${scCount}` : 'без сейфті-карів',
      wasWet ? 'дощ' : 'суха',
      dnfCount > 0 ? `сходів: ${dnfCount}` : 'без сходів',
    ].join(' · ');

    const lapsWord = (n: number) =>
      n % 10 === 1 && n % 100 !== 11
        ? 'коло'
        : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)
          ? 'кола'
          : 'кіл';

    const lines = myCars
      .map((car) => {
        const d = race.debrief(car.driverId);
        const drv = race.driver(car.driverId);
        if (!d || !drv) return '';
        if (car.status === 'dnf')
          return `<li><b>${esc(drv.short)}</b> — схід (${esc(car.dnfReason ?? '')}). Обережніший темп знижує ризик.</li>`;

        const cls = classification.find((c) => c.driver.id === car.driverId);
        const pos = cls?.position ?? 0;
        const gained = cls?.gained ?? 0;

        // Результат — спершу емоція, потім бухгалтерія
        const head =
          pos === 1
            ? '🏆 <b>Перемога!</b>'
            : pos <= 3
              ? `🏅 <b>Подіум — P${pos}</b>${gained > 0 ? ` (+${gained} зі старту)` : ''}.`
              : `P${pos}${gained > 0 ? ` (<b>+${gained}</b> зі старту)` : gained < 0 ? ` (${gained} зі старту)` : ''}.`;

        // Що ЗІГРАЛО: події гонки, обернуті на нашу користь
        const wins: string[] = [];
        if (d.scPits > 0) {
          wins.push(
            `піт${d.scPits > 1 ? 'и' : ''} під жовтими зекономи${d.scPits > 1 ? 'ли' : 'в'} ≈ ${d.flagSaved.toFixed(0)} с`,
          );
        }
        if (wasWet && d.wrongTyreLaps === 0) {
          wins.push('дощ відіграно ідеально: жодного кола на неправильній гумі — це і є радар');
        }
        const wonPart = wins.length > 0 ? ` <b>Зіграло:</b> ${wins.join('; ')}.` : '';

        // Що КОШТУВАЛО секунд — по одному факту на причину
        const bits: string[] = [];
        if (d.wrongTyreLoss >= 3) {
          bits.push(
            `${d.wrongTyreLaps} ${lapsWord(d.wrongTyreLaps)} на гумі не під погоду ≈ <b>${d.wrongTyreLoss.toFixed(0)} с</b>`,
          );
        }
        if (Number.isFinite(d.lostToBest) && d.lostToBest >= 3) {
          bits.push(
            `${d.stops}-стоп проти оптимального ${d.bestStops}-стоп ≈ <b>${d.lostToBest.toFixed(0)} с</b>`,
          );
        }
        if (d.penalty >= 5) bits.push(`штрафи <b>+${d.penalty} с</b>`);

        // Чиста гонка: нічого не втрачено
        if (bits.length === 0) {
          const clean =
            pos <= 3
              ? 'Стратегію відпрацьовано без жодної втрати.'
              : 'Чиста гонка без втрат — вище було лише питання темпу боліда.';
          return `<li><b>${esc(drv.short)}</b> · ${head} ${clean}${wonPart}</li>`;
        }

        // Головна порада — від найбільшої втрати
        const worstIsTyre =
          d.wrongTyreLoss >= Math.max(Number.isFinite(d.lostToBest) ? d.lostToBest : 0, d.penalty);
        const tip = worstIsTyre
          ? 'Дивись на РАДАР: міняй гуму, щойно клітинки показують дощ — ще до перших крапель.'
          : d.penalty >= Math.max(d.wrongTyreLoss, Number.isFinite(d.lostToBest) ? d.lostToBest : 0)
            ? 'Штрафи приходять за агресію в трафіку: менше «5» темпу, коли попереду щільно.'
            : `Наступного разу тримай план на ${d.bestStops} зупин${d.bestStops === 1 ? 'ку' : 'ки'} — «СТРАТЕГІЯ: АВТО» веде саме його.`;

        const potential =
          d.potentialPosition !== null && d.potentialPosition < pos
            ? ` Без цих втрат — приблизно <b>P${d.potentialPosition}</b> замість P${pos}.`
            : '';

        return `<li><b>${esc(drv.short)}</b> · ${head} <b>Втрачено:</b> ${bits.join('; ')}.${potential}${wonPart} ${esc(tip)}</li>`;
      })
      .join('');
    debrief = `<div class="debrief" data-test="debrief">
      <b>📋 Розбір стратегії</b>
      <span class="debrief-ctx">Гонка: ${ctx}</span>
      <ul>${lines}</ul>
    </div>`;
  }

  const panel = document.createElement('div');
  panel.className = 'results-overlay';
  panel.dataset.test = 'results';
  panel.innerHTML = `
    <div class="results">
      <h2>🏁 ${esc(race.track.name)}</h2>
      ${summary}
      ${debrief}
      <table>
        <thead><tr><th></th><th>Пілот</th><th></th><th>±</th><th>Гап</th><th>Піт</th><th>Суміші</th><th>Очки</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <button class="btn primary" data-test="results-next">${seasonState ? 'До штабу' : 'До меню'}</button>
    </div>`;
  app.appendChild(panel);

  panel.querySelector('[data-test="results-next"]')!.addEventListener('click', () => {
    if (seasonState) showHub();
    else showMenu();
  });
}

// Гачок для E2E: дає тестам доступ до живої гонки, щоб перевіряти стан
// симуляції, а не текст на екрані. Типізований в e2e/globals.d.ts.
(window as unknown as { __race: () => RaceView | null }).__race = () => view;
(window as unknown as { __season: () => SeasonState | null }).__season = () => season;

showMenu();
