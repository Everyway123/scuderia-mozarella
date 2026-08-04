// Monte Carlo по всьому календарю. Це той інструмент, заради якого симуляція
// відокремлена від рендеру: тисячі гонок за секунди, без браузера.
//
//   node scripts/balance.ts [гонок на трасу] [довжина]
//   node scripts/balance.ts 20 100

import { DRIVERS_2026 } from '../src/data/drivers2026.ts';
import { TEAMS_2026 } from '../src/data/teams2026.ts';
import { TRACKS_2026 } from '../src/data/tracks2026.ts';
import { Race } from '../src/sim/raceEngine.ts';
import type { RaceLength } from '../src/sim/types.ts';

const perTrack = Number(process.argv[2] ?? 10);
const length = Number(process.argv[3] ?? 100) as RaceLength;

const wins = new Map<string, number>();
const podiums = new Map<string, number>();
const points = new Map<string, number>();
const positions = new Map<string, number[]>();
const driverWins = new Map<string, number>();

let races = 0;
let overtakes = 0;
let dnfs = 0;
let safetyCars = 0;
let stops = 0;
let finishers = 0;
let wetRaces = 0;

const t0 = performance.now();

for (const track of TRACKS_2026) {
  for (let i = 0; i < perTrack; i++) {
    const race = new Race({
      track,
      drivers: DRIVERS_2026,
      teams: TEAMS_2026,
      length,
      seed: i * 104729 + track.round * 31,
    });
    race.runToEnd();
    races++;

    for (const e of race.state.events) {
      if (e.kind === 'overtake') overtakes++;
      else if (e.kind === 'dnf') dnfs++;
      else if (e.kind === 'safety-car') safetyCars++;
    }
    if (race.state.events.some((e) => e.kind === 'weather')) wetRaces++;

    const cls = race.classification();
    const winner = cls.find((c) => c.status !== 'dnf');
    if (winner) {
      wins.set(winner.team.id, (wins.get(winner.team.id) ?? 0) + 1);
      driverWins.set(winner.driver.id, (driverWins.get(winner.driver.id) ?? 0) + 1);
    }

    for (const c of cls) {
      points.set(c.team.id, (points.get(c.team.id) ?? 0) + c.points);
      if (!positions.has(c.team.id)) positions.set(c.team.id, []);
      positions.get(c.team.id)!.push(c.position);
      if (c.status !== 'dnf') {
        stops += c.stops;
        finishers++;
        if (c.position <= 3) podiums.set(c.team.id, (podiums.get(c.team.id) ?? 0) + 1);
      }
    }
  }
}

const ms = performance.now() - t0;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

console.log(`\n  ${races} гонок · ${length}% дистанції · ${(ms / 1000).toFixed(1)} с\n`);

console.log('  КОМАНДА             ТЕМП    ПЕРЕМОГИ  ПОДІУМИ  ОЧКИ    СЕР.ПОЗ');
console.log('  ' + '─'.repeat(66));

const ranked = [...TEAMS_2026].sort((a, b) => (points.get(b.id) ?? 0) - (points.get(a.id) ?? 0));
for (const team of ranked) {
  const w = wins.get(team.id) ?? 0;
  const p = podiums.get(team.id) ?? 0;
  const pts = points.get(team.id) ?? 0;
  const avg = mean(positions.get(team.id) ?? []);
  const share = ((w / races) * 100).toFixed(1);
  console.log(
    `  ${team.name.padEnd(20)}${('+' + team.pace.toFixed(2)).padStart(5)}  ${String(w).padStart(6)} (${share.padStart(4)}%)  ${String(p).padStart(5)}  ${String(pts).padStart(5)}   ${avg.toFixed(2)}`,
  );
}

console.log('\n  НАЙЧАСТІШІ ПЕРЕМОЖЦІ');
const topDrivers = [...driverWins.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
for (const [id, n] of topDrivers) {
  const d = DRIVERS_2026.find((x) => x.id === id)!;
  console.log(`   ${d.name.padEnd(20)} ${String(n).padStart(4)} (${((n / races) * 100).toFixed(1)}%)`);
}

console.log('\n  ДИНАМІКА ГОНКИ (норма Ф1 у дужках)');
console.log(`   обгонів за гонку     ${(overtakes / races).toFixed(1)}   (30–60)`);
console.log(`   сходів за гонку      ${(dnfs / races).toFixed(2)}   (1–3)`);
console.log(`   сейфті-карів         ${(safetyCars / races).toFixed(2)}   (0.3–0.7)`);
console.log(`   піт-стопів на машину ${(stops / finishers).toFixed(2)}   (1.5–2.5)`);
console.log(`   гонок із опадами     ${((wetRaces / races) * 100).toFixed(0)}%   (15–25%)`);
console.log('');
