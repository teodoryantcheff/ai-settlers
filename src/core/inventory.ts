import type { Good, Inventory } from '../types.ts';

/**
 * The goods an inventory (or any table keyed by good) names, in key order, the
 * order `for…in` visits. Simulation scheduling relies on that order.
 */
export function goodsIn(inventory: Readonly<Partial<Record<Good, unknown>>>): Good[] {
  return Object.keys(inventory) as Good[];
}

/**
 * An inventory's goods with their amounts, in the same order as `goodsIn`.
 * Inventories hold a number for every good they name, never `undefined`.
 */
export function inventoryEntries(inventory: Readonly<Inventory>): [Good, number][] {
  return Object.entries(inventory) as [Good, number][];
}
