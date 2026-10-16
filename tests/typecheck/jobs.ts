import type { Job, Unit } from '../../src/types.ts';

// @ts-expect-error Fetch jobs must name their good, source and destination.
const incompleteFetch: Job = { kind: 'fetch', status: 'pending' };
// @ts-expect-error Delivery jobs must name their good and producer source.
const incompleteDelivery: Job = { kind: 'deliver', status: 'pending' };
// @ts-expect-error Transfers must name their good and both stores.
const incompleteTransfer: Job = { kind: 'transfer', status: 'pending' };
// @ts-expect-error Soldier jobs must name their destination.
const incompleteSoldier: Job = { kind: 'soldier', status: 'pending' };
void [incompleteFetch, incompleteDelivery, incompleteTransfer, incompleteSoldier];

const valid: Job[] = [
  { kind: 'fetch', good: 'logs', sourceId: 1, to: 2, status: 'pending' },
  { kind: 'deliver', good: 'logs', sourceId: 2, status: 'assigned' },
  { kind: 'transfer', good: 'logs', sourceId: 1, to: 3, status: 'pending' },
  { kind: 'soldier', to: 4, status: 'assigned' },
];
// @ts-expect-error Fetch requires a good even with both endpoints.
valid.push({ kind: 'fetch', sourceId: 1, to: 2, status: 'pending' });
// @ts-expect-error Fetch requires its source even with a good and destination.
valid.push({ kind: 'fetch', good: 'logs', to: 2, status: 'pending' });
// @ts-expect-error Fetch requires its destination even with cargo and source.
valid.push({ kind: 'fetch', good: 'logs', sourceId: 1, status: 'pending' });
// @ts-expect-error Delivery requires a good.
valid.push({ kind: 'deliver', sourceId: 2, status: 'assigned' });
// @ts-expect-error Delivery requires its producer source.
valid.push({ kind: 'deliver', good: 'logs', status: 'assigned' });
// @ts-expect-error Transfer requires a good.
valid.push({ kind: 'transfer', sourceId: 1, to: 3, status: 'pending' });
// @ts-expect-error Transfer requires its source store.
valid.push({ kind: 'transfer', good: 'logs', to: 3, status: 'pending' });
// @ts-expect-error Transfer requires its destination store.
valid.push({ kind: 'transfer', good: 'logs', sourceId: 1, status: 'pending' });
// @ts-expect-error Soldiers have no cargo.
valid.push({ kind: 'soldier', good: 'logs', to: 4, status: 'assigned' });
// @ts-expect-error Soldiers have no fixed source building.
valid.push({ kind: 'soldier', sourceId: 1, to: 4, status: 'assigned' });
// @ts-expect-error Delivery storage is chosen after pickup, not on the job.
valid.push({ kind: 'deliver', good: 'logs', sourceId: 2, to: 1, status: 'assigned' });
declare const job: Job;
declare const unit: Unit;
// @ts-expect-error The ambiguous source aliases are gone.
job.s;
// @ts-expect-error A producer and store now use the same source field.
job.from;
// @ts-expect-error Job status has a distinct name from simulation state.
job.state;
// @ts-expect-error Carrier phases cannot be assigned to job status.
job.status = unit.phase;
// @ts-expect-error Letter codes are not job statuses.
job.status = 'p';
// @ts-expect-error Letter codes are not job statuses.
job.status = 't';
if (job.kind !== 'soldier') {
  const source: number = job.sourceId;
  const good: string = job.good;
  void [source, good];
}
if (job.kind !== 'deliver') {
  const target: number = job.to;
  void target;
}
