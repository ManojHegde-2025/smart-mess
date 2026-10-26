import { addDays } from "./domain";
import { MEALS, type Usage } from "./types";

// A deterministic synthetic fixture shared by the browser and server.
// Its weekly pattern demonstrates learning, not measured campus accuracy.
export function demoHistory(today: string): Usage[] {
  const rows: Usage[] = [];
  for (let i = 84; i >= 0; i--) {
    const date = addDays(today, -i);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    for (const [index, meal] of MEALS.entries()) {
      const served =
        i === 0
          ? [38, 26, 0][index]
          : [24, 41, 39, 42, 40, 35, 26][weekday] +
            [-3, 2, 0][index] +
            (i % 3) -
            1;
      rows.push({
        date,
        meal,
        served,
        prepared: served === 0 ? 0 : served + 3 + (i % 4),
      });
    }
  }
  return rows;
}
