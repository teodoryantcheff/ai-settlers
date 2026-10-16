import { productionOutputBlocked } from '../gameplay/colony-rules.ts';
import { ingredientShortages } from '../gameplay/production-rules.ts';
import type { Building, BuildingSpec, ProductionBlockReason } from '../types.ts';
export type BlockageReason = Extract<
  ProductionBlockReason,
  'inputs' | 'output' | 'resources' | 'exhausted'
>;
export function deliberatePause(b: Building) {
  return (
    b.disabled ||
    b.blockedReason === 'paused' ||
    b.blockedReason === 'demand' ||
    b.blockedReason === 'reserve'
  );
}
/** Revalidate after carrier arrivals; a bTick reason can already be stale. */
export function productionBlockage(b: Building, sp: BuildingSpec): BlockageReason | null {
  if (!b.done || deliberatePause(b)) return null;
  if (b.exhausted || b.blockedReason === 'exhausted') return 'exhausted';
  if (b.blockedReason === 'inputs' && ingredientShortages(b, sp).length) return 'inputs';
  if (b.blockedReason === 'output' && productionOutputBlocked(b, sp)) return 'output';
  if (b.blockedReason === 'resources') return 'resources';
  return null;
}
