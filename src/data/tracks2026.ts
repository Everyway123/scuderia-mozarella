// Календар 2026 — 24 етапи. Мадрид дебютує, Імола вибула.
//
// baseLap — час кола в гоночному темпі (не квалі), с
// pitLoss — втрата від проїзду піт-лейну без часу стоянки, с
// overtaking — 0..1, наскільки тут узагалі можна обганяти (Монако 0.02, Монца 0.32)
// tyreWear — множник зносу (Катар і Сільверстоун їдять гуму, Монако ні)
// harvestMJ — скільки енергії дає коло: багато гальмувань = багато рекуперації

import type { Track } from '../sim/types.ts';

export const TRACKS_2026: Track[] = [
  { id: 'melbourne', name: 'Альберт-Парк', country: 'Австралія', round: 1, laps: 58, baseLap: 81, pitLoss: 21, overtaking: 0.16, tyreWear: 1.0, fuelPerLap: 1.2, harvestMJ: 8.2, safetyCar: 0.45, rainChance: 0.25, street: true },
  { id: 'shanghai', name: 'Шанхай', country: 'Китай', round: 2, laps: 56, baseLap: 95, pitLoss: 23, overtaking: 0.26, tyreWear: 1.2, fuelPerLap: 1.25, harvestMJ: 8.6, safetyCar: 0.25, rainChance: 0.3, street: false },
  { id: 'suzuka', name: 'Судзука', country: 'Японія', round: 3, laps: 53, baseLap: 92, pitLoss: 22, overtaking: 0.14, tyreWear: 1.2, fuelPerLap: 1.32, harvestMJ: 7.4, safetyCar: 0.3, rainChance: 0.35, street: false },
  { id: 'bahrain', name: 'Сахір', country: 'Бахрейн', round: 4, laps: 57, baseLap: 94, pitLoss: 22, overtaking: 0.28, tyreWear: 1.35, fuelPerLap: 1.23, harvestMJ: 9.0, safetyCar: 0.2, rainChance: 0.02, street: false },
  { id: 'jeddah', name: 'Джидда', country: 'Саудівська Аравія', round: 5, laps: 50, baseLap: 91, pitLoss: 20, overtaking: 0.2, tyreWear: 0.9, fuelPerLap: 1.4, harvestMJ: 7.0, safetyCar: 0.55, rainChance: 0.02, street: true },
  { id: 'miami', name: 'Маямі', country: 'США', round: 6, laps: 57, baseLap: 90, pitLoss: 19, overtaking: 0.22, tyreWear: 1.1, fuelPerLap: 1.22, harvestMJ: 8.4, safetyCar: 0.35, rainChance: 0.2, street: true },
  { id: 'montreal', name: 'Жіль-Вільнев', country: 'Канада', round: 7, laps: 70, baseLap: 74, pitLoss: 17, overtaking: 0.24, tyreWear: 0.85, fuelPerLap: 1.0, harvestMJ: 9.4, safetyCar: 0.45, rainChance: 0.3, street: false },
  { id: 'monaco', name: 'Монако', country: 'Монако', round: 8, laps: 78, baseLap: 74, pitLoss: 19, overtaking: 0.02, tyreWear: 0.7, fuelPerLap: 0.9, harvestMJ: 7.8, safetyCar: 0.65, rainChance: 0.2, street: true },
  { id: 'barcelona', name: 'Барселона', country: 'Іспанія', round: 9, laps: 66, baseLap: 76, pitLoss: 21, overtaking: 0.14, tyreWear: 1.25, fuelPerLap: 1.06, harvestMJ: 8.0, safetyCar: 0.15, rainChance: 0.1, street: false },
  { id: 'spielberg', name: 'Ред-Булл-Ринг', country: 'Австрія', round: 10, laps: 71, baseLap: 68, pitLoss: 19, overtaking: 0.3, tyreWear: 1.1, fuelPerLap: 0.98, harvestMJ: 8.2, safetyCar: 0.3, rainChance: 0.3, street: false },
  { id: 'silverstone', name: 'Сільверстоун', country: 'Велика Британія', round: 11, laps: 52, baseLap: 89, pitLoss: 21, overtaking: 0.22, tyreWear: 1.3, fuelPerLap: 1.34, harvestMJ: 7.2, safetyCar: 0.3, rainChance: 0.45, street: false },
  { id: 'spa', name: 'Спа-Франкоршам', country: 'Бельгія', round: 12, laps: 44, baseLap: 107, pitLoss: 19, overtaking: 0.3, tyreWear: 1.15, fuelPerLap: 1.55, harvestMJ: 7.0, safetyCar: 0.3, rainChance: 0.5, street: false },
  { id: 'hungaroring', name: 'Хунгароринг', country: 'Угорщина', round: 13, laps: 70, baseLap: 78, pitLoss: 20, overtaking: 0.08, tyreWear: 1.1, fuelPerLap: 0.98, harvestMJ: 8.6, safetyCar: 0.2, rainChance: 0.2, street: false },
  { id: 'zandvoort', name: 'Зандворт', country: 'Нідерланди', round: 14, laps: 72, baseLap: 73, pitLoss: 19, overtaking: 0.1, tyreWear: 1.15, fuelPerLap: 0.96, harvestMJ: 7.6, safetyCar: 0.3, rainChance: 0.35, street: false },
  { id: 'monza', name: 'Монца', country: 'Італія', round: 15, laps: 53, baseLap: 83, pitLoss: 21, overtaking: 0.32, tyreWear: 0.9, fuelPerLap: 1.3, harvestMJ: 6.4, safetyCar: 0.25, rainChance: 0.2, street: false },
  { id: 'madrid', name: 'Мадринг', country: 'Іспанія', round: 16, laps: 57, baseLap: 92, pitLoss: 21, overtaking: 0.15, tyreWear: 1.05, fuelPerLap: 1.22, harvestMJ: 8.4, safetyCar: 0.3, rainChance: 0.1, street: true },
  { id: 'baku', name: 'Баку', country: 'Азербайджан', round: 17, laps: 51, baseLap: 104, pitLoss: 19, overtaking: 0.28, tyreWear: 0.8, fuelPerLap: 1.36, harvestMJ: 9.2, safetyCar: 0.6, rainChance: 0.1, street: true },
  { id: 'singapore', name: 'Марина-Бей', country: 'Сінгапур', round: 18, laps: 62, baseLap: 93, pitLoss: 27, overtaking: 0.1, tyreWear: 1.0, fuelPerLap: 1.13, harvestMJ: 9.6, safetyCar: 0.6, rainChance: 0.4, street: true },
  { id: 'austin', name: 'Америкас', country: 'США', round: 19, laps: 56, baseLap: 96, pitLoss: 21, overtaking: 0.24, tyreWear: 1.2, fuelPerLap: 1.25, harvestMJ: 8.4, safetyCar: 0.25, rainChance: 0.2, street: false },
  { id: 'mexico', name: 'Ерманос-Родрігес', country: 'Мексика', round: 20, laps: 71, baseLap: 79, pitLoss: 22, overtaking: 0.26, tyreWear: 0.95, fuelPerLap: 0.98, harvestMJ: 7.4, safetyCar: 0.3, rainChance: 0.2, street: false },
  { id: 'interlagos', name: 'Інтерлагос', country: 'Бразилія', round: 21, laps: 71, baseLap: 72, pitLoss: 21, overtaking: 0.28, tyreWear: 1.1, fuelPerLap: 0.98, harvestMJ: 8.0, safetyCar: 0.35, rainChance: 0.45, street: false },
  { id: 'vegas', name: 'Лас-Вегас', country: 'США', round: 22, laps: 50, baseLap: 95, pitLoss: 20, overtaking: 0.25, tyreWear: 0.75, fuelPerLap: 1.4, harvestMJ: 7.2, safetyCar: 0.5, rainChance: 0.1, street: true },
  { id: 'lusail', name: 'Лусаїл', country: 'Катар', round: 23, laps: 57, baseLap: 85, pitLoss: 25, overtaking: 0.18, tyreWear: 1.4, fuelPerLap: 1.23, harvestMJ: 7.6, safetyCar: 0.25, rainChance: 0.02, street: false },
  { id: 'yasmarina', name: 'Яс-Маріна', country: 'ОАЕ', round: 24, laps: 58, baseLap: 87, pitLoss: 21, overtaking: 0.18, tyreWear: 1.0, fuelPerLap: 1.2, harvestMJ: 8.2, safetyCar: 0.25, rainChance: 0.02, street: false },
];

export const TRACK_BY_ID = new Map(TRACKS_2026.map((t) => [t.id, t]));

export function trackByRound(round: number): Track {
  return TRACKS_2026.find((t) => t.round === round) ?? TRACKS_2026[0]!;
}
