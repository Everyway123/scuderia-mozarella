// Гачок, який застосунок віддає тестам: доступ до живого екрана гонки.
// Потрібен, щоб перевіряти стан симуляції, а не текст на екрані.

interface RaceViewHandle {
  promptCount: number;
  race: {
    state: {
      lap: number;
      totalLaps: number;
      finished: boolean;
      flag: string;
      weather: string;
    };
    playerCars(): {
      driverId: string;
      paceMode: number;
      energyMode: string;
      pitRequest: string | null;
      autoStrategy: boolean;
      stops: number;
      tyre: { compound: string; age: number; wear: number };
      position: number;
      status: string;
    }[];
    classification(): {
      position: number;
      driver: { id: string };
      team: { id: string };
      points: number;
      status: string;
      totalTime: number;
    }[];
  };
}

interface Window {
  __race?: () => RaceViewHandle | null;
}
