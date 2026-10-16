import type { validateSave } from '../../src/core/state.ts';
import type { recipeRequirements } from '../../src/gameplay/production-rules.ts';
import type { LessonStep, ProgressionSubsystem } from '../../src/gameplay/progression.ts';
import type { NavigationSubsystem } from '../../src/simulation/navigation.ts';
import type { Building, ColonyIdentity, Inventory, ValidatedSave } from '../../src/types.ts';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

// The main compiler preserves nullable domain contracts.
export type MissingRoute = Assert<
  Equal<ReturnType<NavigationSubsystem['findPath']>, number[] | null>
>;
export type MissingOutpost = Assert<
  Equal<ReturnType<ProgressionSubsystem['pendingOutpost']>, Building | undefined>
>;
export type CompletedLessons = Assert<
  Equal<
    ReturnType<ProgressionSubsystem['currentLesson']>,
    { step: LessonStep; index: number } | null
  >
>;
export type AbsentRecipe = Assert<
  Equal<ReturnType<typeof recipeRequirements>, Readonly<Inventory> | undefined>
>;
export type UntrustedInput = Assert<Equal<Parameters<typeof validateSave>[0], unknown>>;
export type NormalizedIdentity = Assert<Equal<ValidatedSave['identity'], ColonyIdentity>>;
export type ContinuationState = Assert<Equal<Extract<ValidatedSave, { v: 2 }>['rng'], number>>;
