import type { Job, Unit } from '../types.ts';

export type DeliveryStage = 'queued' | 'assigned' | 'carrying' | 'unknown';

/** The caller matches a live carrier; a recorded assignment alone is not physical cargo. */
export function deliveryStage(
  job: Pick<Job, 'status'>,
  carrier: Pick<Unit, 'carry'> | null | undefined,
): DeliveryStage {
  return carrier?.carry
    ? 'carrying'
    : carrier
      ? 'assigned'
      : job.status === 'assigned'
        ? 'unknown'
        : 'queued';
}
