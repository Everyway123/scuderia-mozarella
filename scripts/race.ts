// Headless-гонка в терміналі. Це критерій приймання M1:
// якщо тут нудно дивитись на таблицю — крутимо константи, а не малюємо UI.
//
//   node scripts/race.ts [trackId] [length] [seed]
//   node scripts/race.ts monza 100 42

import { DRIVERS_2026 } from '../src/data/drivers2026.ts';
import { TEAMS_2026 } from '../src/data/teams2026.ts';
import { TRACKS_2026, TRACK_BY_ID } from '../src/data/tracks2026.ts';
import { COMPOUNDS } from '../src/sim/constants.ts';
import { gridFromQuali, runQualifying } from '../src/sim/qualifying.ts';
import { Race, fmt } from '../src/sim/raceEngine.ts';
import { Rng } from '../src/sim/rng.ts';
import type { RaceLength } from '../src/sim/types.ts';

const trackId = process.argv[2] ?? 'bahrain';
const length = Number(process.argv[3] ?? 100) as RaceLength;
const seed = Number(process.argv[4] ?? 2026);

const track = TRACK_BY_ID.get(trackId);
if (!track) {
  console.error(`Немає траси "${trackId}". Доступні:`);
  console.error(TRACKS_2026.map((t) => `  ${t.id.padEnd(14)} ${t.name}`).join('\n'));
  process.exit(1);
  throw new Error('unreachable');
}

const teamMap = new Map(TEAMS_2026.map((t) => [t.id, t]));
const quali = runQualifying(track, DRIVERS_2026, teamMap, new Rng(seed ^ 0x51ed));
const grid = gridFromQuali(quali);

const race = new Race({
  track,
  drivers: DRIVERS_2026,
  teams: TEAMS_2026,
  length,
  seed,
  grid,
});

const t0 = performance.now();
race.runToEnd();
const ms = performance.now() - t0;

const pole = quali[0]!;
console.log(`\n  ${track.name} · ${track.country}`);
console.log(`  ${race.totalLaps} кіл (${length}% дистанції) · seed ${seed}`);
console.log(
  `  Поул: ${DRIVERS_2026.find((d) => d.id === pole.driverId)!.name} — ${fmt(pole.time)}\n`,
);

console.log('  ПОЗ  ПІЛОТ                КОМАНДА  ГАП        ПІТ  СУМІШІ            ОЧК');
console.log('  ' + '─'.repeat(78));

for (const r of race.classification()) {
  const pos = r.status === 'dnf' ? ' —' : String(r.position).padStart(2);
  const gap =
    r.status === 'dnf'
      ? `сход (${r.dnfReason})`
      : r.position === 1
        ? fmt(r.totalTime)
        : `+${(r.gap ?? 0).toFixed(3)}`;
  const comps = r.compounds.map((c) => COMPOUNDS[c].label).join('→');
  const fl = r.fastestLap ? ' ⚡' : '';
  console.log(
    `  ${pos}   ${r.driver.name.padEnd(20)} ${r.team.short.padEnd(4)}  ${gap.padEnd(24)} ${String(r.stops)}   ${comps.padEnd(18)} ${String(r.points).padStart(2)}${fl}`,
  );
}

const st = race.state;
console.log(`\n  Погода на фініші: ${st.weather} · подій у стрічці: ${st.events.length}`);
if (st.fastestLap) {
  const d = DRIVERS_2026.find((x) => x.id === st.fastestLap!.driverId)!;
  console.log(`  Найшвидше коло: ${d.short} ${fmt(st.fastestLap.time)}`);
}
console.log(`  Симуляція: ${ms.toFixed(1)} мс\n`);

const highlights = st.events.filter(
  (e) => e.kind === 'overtake' || e.kind === 'dnf' || e.kind === 'safety-car',
);
if (highlights.length) {
  console.log('  ХРОНІКА');
  for (const e of highlights.slice(0, 18)) {
    console.log(`   коло ${String(e.lap).padStart(2)}  ${e.text}`);
  }
  if (highlights.length > 18) console.log(`   ... ще ${highlights.length - 18} подій`);
  console.log('');
}
