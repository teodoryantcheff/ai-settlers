import { ingredientShortages } from '../gameplay/production-rules.ts';
import type { Building, BuildingSpec } from '../types.ts';
export type BlockageReason = 'inputs' | 'output' | 'resources' | 'exhausted';
export function deliberatePause(b: Building) {
  return b.disabled || ['paused', 'demand', 'reserve'].includes(b.blockedReason);
}
/** Revalidate after carrier arrivals; a bTick reason can already be stale. */
export function productionBlockage(b: Building, sp: BuildingSpec): BlockageReason | null {
  if (!b.done || deliberatePause(b)) return null;
  if (b.exhausted || b.blockedReason === 'exhausted') return 'exhausted';
  if (b.blockedReason === 'inputs' && ingredientShortages(b, sp).length) return 'inputs';
  if (b.blockedReason === 'output' && (b.stock[sp.out] || 0) + (sp.prod === 'gather' ? 2 : 1) > 8)
    return 'output';
  if (b.blockedReason === 'resources') return 'resources';
  return null;
}
