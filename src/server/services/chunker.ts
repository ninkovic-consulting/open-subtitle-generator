import type { Silence } from './media.js';

export interface Chunk {
  index: number;
  start: number;
  end: number;
}

export interface ChunkPlanOptions {
  /** Target chunk length in seconds (default 600). */
  targetSec?: number;
  /** Search window around each target boundary for a silence (default ±90 s). */
  windowSec?: number;
}

/**
 * Plans chunk boundaries for speech-to-text. Each boundary is placed at the midpoint of the silence
 * closest to the target boundary within ±window; without a nearby silence it is a hard cut.
 */
export function planChunks(
  durationSec: number,
  silences: Silence[],
  opts: ChunkPlanOptions = {},
): Chunk[] {
  const target = opts.targetSec ?? 600;
  const window = opts.windowSec ?? 90;
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [];
  const mids = silences.map((s) => (s.start + s.end) / 2).sort((a, b) => a - b);
  const chunks: Chunk[] = [];
  let pos = 0;
  // Keep the last chunk from becoming a tiny tail: stop splitting when the rest fits comfortably.
  while (durationSec - pos > target + window / 2) {
    const desired = pos + target;
    let best: number | null = null;
    for (const m of mids) {
      if (m <= pos + target / 4) continue;
      if (m < desired - window) continue;
      if (m > desired + window) break;
      if (best === null || Math.abs(m - desired) < Math.abs(best - desired)) best = m;
    }
    const cut = Math.min(best ?? desired, durationSec);
    chunks.push({ index: chunks.length, start: pos, end: cut });
    pos = cut;
  }
  chunks.push({ index: chunks.length, start: pos, end: durationSec });
  return chunks;
}
