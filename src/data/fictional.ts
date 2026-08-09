// Вигаданий грид для ПУБЛІЧНИХ збірок (VITE_GRID=fictional).
//
// Реальні назви команд і імена пілотів — чужі торгові марки й персональні
// бренди: для приватного пет-проєкту це нормально, для публічного хостингу —
// ні. Тому публічна збірка підміняє ЛИШЕ те, що видно на екрані: назви,
// імена, трилітерні коди. Внутрішні id, весь баланс, характеристики і
// збереження — байтово ті самі, тож тести й сейви працюють з обома гридами.

export interface FictionalTeamName {
  name: string;
  short: string;
}

export interface FictionalDriverName {
  name: string;
  short: string;
}

export const FICTIONAL_TEAMS: Record<string, FictionalTeamName> = {
  mercedes: { name: 'Silberstern Grand Prix', short: 'SIL' },
  mclaren: { name: 'Papaya Motorsport', short: 'PAP' },
  redbull: { name: 'Taurus Energy Racing', short: 'TAU' },
  ferrari: { name: 'Scuderia Vulcano', short: 'VUL' },
  williams: { name: 'Atlantic Grand Prix', short: 'ATL' },
  aston: { name: 'Verdant Racing', short: 'VRD' },
  racingbulls: { name: 'Vitesse Junior Team', short: 'VIT' },
  audi: { name: 'Rheinwerk F1', short: 'RHW' },
  alpine: { name: 'Montagne F1 Team', short: 'MTG' },
  haas: { name: 'Liberty Machine Racing', short: 'LIB' },
  cadillac: { name: 'Motor City Racing', short: 'MCR' },
};

export const FICTIONAL_DRIVERS: Record<string, FictionalDriverName> = {
  russell: { name: 'Harry Wexford', short: 'WEX' },
  antonelli: { name: 'Dario Moretti', short: 'MRT' },
  norris: { name: 'Theo Ashcroft', short: 'ASH' },
  piastri: { name: 'Jack Callahan', short: 'CAL' },
  verstappen: { name: 'Kees van Dorn', short: 'DOR' },
  hadjar: { name: 'Samir Belkacem', short: 'BEL' },
  leclerc: { name: 'Luca Moncelli', short: 'MON' },
  hamilton: { name: 'Marcus Kingsley', short: 'KIN' },
  sainz: { name: 'Diego Herrera', short: 'HER' },
  albon: { name: 'Nat Thawan', short: 'THA' },
  alonso: { name: 'Ramón Vidal', short: 'VID' },
  stroll: { name: 'Chase Beaumont', short: 'BMT' },
  lawson: { name: 'Ryan Teague', short: 'TEA' },
  lindblad: { name: 'Erik Nystrom', short: 'NYS' },
  hulkenberg: { name: 'Jonas Kraft', short: 'KRA' },
  bortoleto: { name: 'Rafael Duarte', short: 'DUA' },
  gasly: { name: 'Antoine Leroux', short: 'LER' },
  colapinto: { name: 'Mateo Farias', short: 'FAR' },
  ocon: { name: 'Julien Marchand', short: 'MAR' },
  bearman: { name: 'Freddie Hale', short: 'HAL' },
  perez: { name: 'Andrés Roca', short: 'ROC' },
  bottas: { name: 'Timo Salmi', short: 'SAL' },
};

/** Чи ця збірка має використовувати вигаданий грид. */
export function useFictionalGrid(): boolean {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  return env?.VITE_GRID === 'fictional';
}
