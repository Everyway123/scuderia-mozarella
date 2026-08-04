// Точка входу: вибір етапу → квала → гонка → класифікація.
// У M2 гравець ще нічого не вирішує — він дивиться. Важелі пітволу прийдуть у M3.

import './style.css';
import { DRIVERS_2026 } from './data/drivers2026.ts';
import { TEAMS_2026 } from './data/teams2026.ts';
import { TRACKS_2026, TRACK_BY_ID } from './data/tracks2026.ts';
import { RaceView } from './race/RaceView.ts';
import { COMPOUNDS } from './sim/constants.ts';
import { gridFromQuali, runQualifying } from './sim/qualifying.ts';
import { fmt, type Race } from './sim/raceEngine.ts';
import { Rng } from './sim/rng.ts';
import type { RaceLength } from './sim/types.ts';

const app = document.querySelector<HTMLDivElement>('#app')!;
const teamMap = new Map(TEAMS_2026.map((t) => [t.id, t]));

let view: RaceView | null = null;

function showSetup(): void {
  view?.destroy();
  view = null;

  app.innerHTML = `
    <div class="setup">
      <h1>🧀 SCUDERIA MOZARELLA</h1>
      <p class="sub">F1-менеджер, сезон 2026. Обери етап і дивись гонку з пітволу.</p>

      <label class="field">
        <span>Етап</span>
        <select id="trackSel">
          ${TRACKS_2026.map(
            (t) => `<option value="${t.id}">${t.round}. ${t.name} — ${t.country}</option>`,
          ).join('')}
        </select>
      </label>

      <label class="field">
        <span>Довжина гонки</span>
        <div class="seg" id="lenSeg">
          <button data-len="25">25% · ~3 хв</button>
          <button data-len="50">50% · ~7 хв</button>
          <button data-len="100" class="on">100% · ~15 хв</button>
        </div>
      </label>

      <label class="field">
        <span>Seed</span>
        <input id="seedInput" type="number" value="2026" />
      </label>

      <p class="hint" id="lenHint"></p>

      <button class="btn primary big" id="goBtn">🏁 НА СТАРТ</button>
    </div>
  `;

  let length: RaceLength = 100;
  const seg = app.querySelector('#lenSeg')!;
  const hint = app.querySelector('#lenHint')!;

  const updateHint = () => {
    const track = TRACK_BY_ID.get(
      app.querySelector<HTMLSelectElement>('#trackSel')!.value,
    )!;
    const laps = Math.max(5, Math.round((track.laps * length) / 100));
    hint.textContent =
      `${laps} кіл із ${track.laps}. Скорочена гонка стиснута, а не обрізана: ` +
      `гума й паливо витрачаються пропорційно швидше, тож стратегія лишається тією самою.`;
  };

  seg.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    seg.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
    btn.classList.add('on');
    length = Number(btn.dataset.len) as RaceLength;
    updateHint();
  });

  app.querySelector('#trackSel')!.addEventListener('change', updateHint);
  updateHint();

  app.querySelector('#goBtn')!.addEventListener('click', () => {
    const trackId = app.querySelector<HTMLSelectElement>('#trackSel')!.value;
    const seed = Number(app.querySelector<HTMLInputElement>('#seedInput')!.value) || 2026;
    startRace(trackId, length, seed);
  });
}

function startRace(trackId: string, length: RaceLength, seed: number): void {
  const track = TRACK_BY_ID.get(trackId)!;
  const quali = runQualifying(track, DRIVERS_2026, teamMap, new Rng(seed ^ 0x51ed));

  view?.destroy();
  view = new RaceView(app, {
    track,
    drivers: DRIVERS_2026,
    teams: TEAMS_2026,
    length,
    seed,
    grid: gridFromQuali(quali),
    onFinish: (race) => showResults(race),
  });
}

function showResults(race: Race): void {
  const rows = race
    .classification()
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
      return `<tr class="${c.status === 'dnf' ? 'out' : ''}">
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
  panel.innerHTML = `
    <div class="results">
      <h2>🏁 ФІНІШ · ${race.track.name}</h2>
      <table>
        <thead><tr><th></th><th>Пілот</th><th></th><th>Гап</th><th>Піт</th><th>Суміші</th><th>Очки</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <button class="btn primary" id="againBtn">До вибору етапу</button>
    </div>
  `;
  app.appendChild(panel);
  panel.querySelector('#againBtn')!.addEventListener('click', () => showSetup());
}

showSetup();
