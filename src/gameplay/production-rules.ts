import type { Building, BuildingSpec, Good, Inventory } from '../types.ts';

type RecipeBuilding = Pick<Building, 'type' | 'legacyIndustry'>;

/** Order is part of deterministic meal selection and ingredient job scheduling. */
export const edibleGoods: readonly Good[] = Object.freeze(['bread', 'meat', 'fish', 'food']);
const meals: Readonly<Inventory> = Object.freeze({ bread: 1, meat: 1, fish: 1, food: 1 });
const legacyArmory: Readonly<Inventory> = Object.freeze({ iron: 1, coal: 1 });
const noIngredients: Readonly<Inventory> = Object.freeze({});

/** Nominal requirements; a mine's food requirement means any edible good. */
export function recipeRequirements(
  building: RecipeBuilding,
  spec: BuildingSpec,
): Readonly<Inventory> {
  return building.type === 'armory' && building.legacyIndustry ? legacyArmory : spec.in;
}

/** Alternatives for one requirement, not a choice of the next meal to consume. */
export function ingredientAlternatives(spec: BuildingSpec, good: Good): readonly Good[] {
  return spec.prod === 'mine' && good === 'food' ? edibleGoods : [good];
}

/** Eligible deliveries with their recipe quantities; mine meals are alternatives. */
export function eligibleIngredients(
  building: RecipeBuilding,
  spec: BuildingSpec,
): Readonly<Inventory> {
  return spec.prod === 'mine' ? meals : recipeRequirements(building, spec) || noIngredients;
}

/** Pure selection: callers retain readiness checks, stock mutation and cycle timing. */
export function ingredientsConsumedNext(
  building: RecipeBuilding & Pick<Building, 'stock'>,
  spec: BuildingSpec,
): Readonly<Inventory> {
  if (spec.prod !== 'mine') return recipeRequirements(building, spec) || noIngredients;
  let good: Good;
  for (const meal of edibleGoods)
    if ((building.stock[meal] || 0) > (good ? building.stock[good] || 0 : 0)) good = meal;
  // Preserve the missing-food diagnosis when no meal is stocked.
  return { [good || 'food']: 1 };
}

/** Current shortages for the cycle selected from stock; never mutates that stock. */
export function ingredientShortages(
  building: RecipeBuilding & Pick<Building, 'stock'>,
  spec: BuildingSpec,
): ReadonlyArray<{ good: Good; have: number; need: number }> {
  const inputs = ingredientsConsumedNext(building, spec);
  const missing: Array<{ good: Good; have: number; need: number }> = [];
  for (const good of Object.keys(inputs) as Good[]) {
    const have = building.stock[good] || 0;
    if (have < inputs[good]) missing.push({ good, have, need: inputs[good] });
  }
  return missing;
}

/** Work units are countdown seconds, not a recorded cycle start (startup/retry intervals may differ). */
export function productionTiming(
  building: Pick<Building, 'stock'>,
  spec: BuildingSpec,
  upgrade = 0,
) {
  const base = spec.time ?? 0;
  const tier = Math.min(3, upgrade || 0);
  const variety = spec.prod === 'mine' ? foodVarietyBonus(building) : 0;
  return { base, tier, variety, upgradeFactor: Math.pow(0.9, tier), foodMultiplier: 1 + variety };
}

/** Existing meal-variety speed bonus; selection order and stock are unchanged. */
export function foodVarietyBonus(building: Pick<Building, 'stock'>) {
  return Math.min(
    0.1,
    Math.max(0, edibleGoods.filter((good) => (building.stock[good] || 0) > 0).length - 1) * 0.05,
  );
}
