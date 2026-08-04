// Оболонка застосунку: меню → штаб сезону → гонка → результат → штаб.
//
// Атрибути data-test навмисно стабільні: за них тримаються E2E-сценарії,
// і ламати їх косметичними правками не можна.

import './style.css';
import { DRIVERS_2026, driversOfTeam } from './data/drivers2026.ts';
import { TEAMS_2026 } from './data/teams2026.ts';
import { TRACKS_2026, TRACK_BY_ID } from './data/tracks2026.ts';
import { RaceView } from './race/RaceView.ts';
import {
  clearSave,
  currentTrack,
  DEV_AREAS,
  DEV_MAX,
  devCost,
  driverStandings,
  isSeasonOver,
  load,
  newSeason,
  raceSeed,
  recordRace,
  save,
  teamsForRound,
  teamStandings,
  type DevArea,
  type SeasonState,
} from './season/season.ts';
import { COMPOUNDS } from './sim/constants.ts';
import { gridFromQuali, runQualifying } from './sim/qualifying.ts';
import { fmt, type Race } from './sim/raceEngine.ts';
import { Rng } from './sim/rng.ts';
import type { RaceLength, Team } from './sim/types.ts';

const app = document.querySelector<HTMLDivElement>('#app')!;
let view: RaceView | null = null;
let season: SeasonState | null = null;

/** Швидка гонка поза сезоном. */
let quick: { trackId: string; length: RaceLength; seed: number; teamId: string } | null = null;

function clearView(): void {
  view?.destroy();
  view = null;
}

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
            return `<option value="${t.id}">${t.name} — ${ds}</option>`;
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
            : 'Аутсайдер. Кожне очко — подія. Найчесніший тест стратегії.';
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
    quick = {
      trackId: TRACKS_2026[0]!.id,
      length,
      seed: 2026,
      teamId: teamSel.value,
    };
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
          ${TRACKS_2026.map((t) => `<option value="${t.id}">${t.round}. ${t.name} — ${t.country}</option>`).join('')}
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
    startRace(TRACK_BY_ID.get(q.trackId)!.id, q.length, q.seed, TEAMS_2026, q.teamId, null);
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
  const dStand = driverStandings(s).slice(0, 10);
  const tStand = teamStandings(s);
  const myTeamPos = tStand.findIndex((r) => r.id === s.teamId) + 1;

  app.innerHTML = `
    <div class="hub" data-test="hub">
      <header class="hub-head" style="--team:${team.color}">
        <div><b>${team.name}</b><span>сезон 2026 · ${myTeamPos}-е місце в кубку конструкторів</span></div>
        <button class="btn ghost" data-test="to-menu">← Меню</button>
      </header>

      <div class="hub-grid">
        <section class="card next-race">
          <h3>Етап ${s.round} з 24</h3>
          <div class="track-name">${track.name}</div>
          <div class="track-meta">${track.country} · ${Math.max(5, Math.round((track.laps * s.length) / 100))} кіл (${s.length}%)</div>
          <ul class="track-facts">
            <li>Знос гуми: <b>${track.tyreWear >= 1.2 ? 'високий' : track.tyreWear >= 0.95 ? 'середній' : 'низький'}</b></li>
            <li>Обгін: <b>${track.overtaking >= 0.25 ? 'легко' : track.overtaking >= 0.15 ? 'важко' : 'майже неможливо'}</b></li>
            <li>Втрата на піт: <b>${track.pitLoss} с</b></li>
            <li>Шанс дощу: <b>${Math.round(track.rainChance * 100)}%</b></li>
            <li>Сейфті-кар: <b>${Math.round(track.safetyCar * 100)}%</b></li>
          </ul>
          <button class="btn primary big" data-test="start-race">🏁 НА СТАРТ</button>
        </section>

        <section class="card">
          <h3>Розробка боліда · <span class="rp" data-test="rp">${s.rp} RP</span></h3>
          <div class="dev-list">
            ${DEV_AREAS.map((a) => {
              const lvl = s.development[a.id];
              const cost = devCost(lvl);
              const maxed = lvl >= DEV_MAX;
              return `<div class="dev-row">
                <div class="dev-info"><b>${a.label}</b><span>${a.note}</span></div>
                <div class="dev-pips">${Array.from({ length: DEV_MAX }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</div>
                <button class="btn small" data-dev="${a.id}" data-test="dev-${a.id}"
                  ${maxed || s.rp < cost ? 'disabled' : ''}>${maxed ? 'макс' : `+1 · ${cost}`}</button>
              </div>`;
            }).join('')}
          </div>
        </section>

        <section class="card">
          <h3>Пілоти</h3>
          <ol class="stand" data-test="driver-standings">
            ${dStand
              .map(
                (r, i) =>
                  `<li class="${r.isPlayer ? 'mine' : ''}"><span class="n">${i + 1}</span><span class="dot" style="background:${r.color}"></span>${r.name}<b>${r.points}</b></li>`,
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
                  `<li class="${r.isPlayer ? 'mine' : ''}"><span class="n">${i + 1}</span><span class="dot" style="background:${r.color}"></span>${r.name}<b>${r.points}</b></li>`,
              )
              .join('')}
          </ol>
        </section>
      </div>
    </div>`;

  app.querySelector('[data-test="to-menu"]')!.addEventListener('click', showMenu);
  app.querySelector('[data-test="start-race"]')!.addEventListener('click', () => {
    startRace(track.id, s.length, raceSeed(s), teamsForRound(s), s.teamId, s);
  });

  for (const btn of app.querySelectorAll<HTMLButtonElement>('[data-dev]')) {
    btn.addEventListener('click', () => {
      const area = btn.dataset.dev as DevArea;
      const cost = devCost(s.development[area]);
      if (s.rp < cost || s.development[area] >= DEV_MAX) return;
      s.rp -= cost;
      s.development[area] += 1;
      save(s);
      showHub();
    });
  }
}

function showSeasonEnd(): void {
  const s = season!;
  const tStand = teamStandings(s);
  const pos = tStand.findIndex((r) => r.id === s.teamId) + 1;
  app.innerHTML = `
    <div class="setup" data-test="season-end">
      <h1>🏆 Сезон завершено</h1>
      <p class="sub">${tStand[0]!.name} — чемпіон світу серед конструкторів.</p>
      <p class="hint">Твоя команда: <b>${pos}-е місце</b>, ${tStand[pos - 1]?.points ?? 0} очок за 24 етапи.</p>
      <button class="btn primary big" data-test="restart">Новий сезон</button>
    </div>`;
  app.querySelector('[data-test="restart"]')!.addEventListener('click', () => {
    clearSave();
    showMenu();
  });
}

// -------------------------------------------------------------- ГОНКА

function startRace(
  trackId: string,
  length: RaceLength,
  seed: number,
  teams: Team[],
  playerTeamId: string,
  seasonState: SeasonState | null,
): void {
  const track = TRACK_BY_ID.get(trackId)!;
  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const quali = runQualifying(track, DRIVERS_2026, teamMap, new Rng(seed ^ 0x51ed));

  clearView();
  view = new RaceView(app, {
    track,
    drivers: DRIVERS_2026,
    teams,
    length,
    seed,
    grid: gridFromQuali(quali),
    playerTeamId,
    onFinish: (race) => showResults(race, seasonState, trackId),
  });
}

function showResults(race: Race, seasonState: SeasonState | null, trackId: string): void {
  const classification = race.classification();
  let scored = 0;
  let best = 0;

  if (seasonState) {
    const rec = recordRace(seasonState, classification, trackId);
    scored = rec.pointsScored;
    best = rec.bestPosition;
    save(seasonState);
  }

  const rows = classification
    .map((c) => {
      const gap =
        c.status === 'dnf'
          ? `<i>сход — ${c.dnfReason}</i>`
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
      return `<tr class="${c.status === 'dnf' ? 'out' : ''}${mine ? ' mine' : ''}">
        <td class="pos">${c.status === 'dnf' ? '—' : c.position}</td>
        <td><span class="dot" style="background:${c.team.color}"></span>${c.driver.name}</td>
        <td class="dim">${c.team.short}</td>
        <td class="mono">${gap}</td>
        <td>${c.stops}</td>
        <td>${comps}</td>
        <td class="pts">${c.points || ''}${c.fastestLap ? ' ⚡' : ''}</td>
      </tr>`;
    })
    .join('');

  const panel = document.createElement('div');
  panel.className = 'results-overlay';
  panel.dataset.test = 'results';
  panel.innerHTML = `
    <div class="results">
      <h2>🏁 ${race.track.name}</h2>
      ${
        seasonState
          ? `<p class="results-sum" data-test="results-summary">Команда: найкраща позиція <b>P${best || '—'}</b>, зароблено <b>${scored}</b> очок. Розробка: <b>+${3 + Math.round(scored / 4)} RP</b>.</p>`
          : ''
      }
      <table>
        <thead><tr><th></th><th>Пілот</th><th></th><th>Гап</th><th>Піт</th><th>Суміші</th><th>Очки</th></tr></thead>
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

showMenu();
