import { generateSyntheticUsage, SYNTHETIC_COMPLETED_DAYS } from "./synthetic-data";
import type { Usage } from "./types";

/**
 * Deterministic synthetic historical fixture for demonstration mode.
 * Produces 84 completed days of contiguous breakfast, lunch, and dinner records.
 */
export function demoHistory(today: string): Usage[] {
  return generateSyntheticUsage(today, SYNTHETIC_COMPLETED_DAYS);
}
