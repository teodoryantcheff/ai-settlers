import type { Good } from '../types.ts';

/** Fixed presentation order follows supply chains, without consulting simulation state. */
export const RESOURCE_GROUPS: { name: string; goods: Good[] }[] = [
  { name: 'Construction materials', goods: ['logs', 'planks', 'stone'] },
  {
    name: 'Food and farming',
    goods: ['food', 'fish', 'grain', 'flour', 'bread', 'pigs', 'meat', 'beer'],
  },
  {
    name: 'Mining and metalwork',
    goods: ['coal', 'iron', 'iron_bars', 'tools', 'weapons', 'gold'],
  },
];

const drawings: Record<Good, string> = {
  logs: '<path fill="#98643b" d="m5 10 13-5 8 7-13 6z"/><path fill="#b67a48" d="m5 16 13-5 8 7-13 6z"/><ellipse cx="10" cy="21" rx="5" ry="4" fill="#e8bd7b"/><ellipse cx="10" cy="21" rx="2" ry="1.5" fill="none"/><path d="m17 16 7-3"/>',
  planks:
    '<path fill="#dcad65" d="m4 9 19-3 5 6-19 3zM4 17l19-3 5 6-19 3z"/><path d="m9 11 13-2M9 19l13-2"/>',
  stone:
    '<path fill="#a5aeb0" d="m4 23 1-10 8-6 11 3 5 11-7 5-12-1z"/><path d="m5 13 9 4 10-7M14 17l-4 8" fill="none"/>',
  food: '<path fill="#af8150" d="m5 14 3 12h16l3-12z"/><path fill="#dbab57" d="M9 14V8h8l3 6"/><circle cx="23" cy="12" r="5" fill="#a5ad62"/><path d="M8 18h16M10 22h12"/>',
  fish: '<path fill="#8dc3c7" d="M5 16c7-10 15-7 20 0-5 7-13 10-20 0l-3 6V10z"/><circle cx="22" cy="14" r="1" fill="#293a35"/><path d="m12 12 4 4-4 4" fill="none"/>',
  grain:
    '<path d="M16 28V5m0 15-6-5m6 0 6-5m-6 0-5-4" fill="none"/><path fill="#e5bb55" d="M15 20c-7 0-8-4-8-7 5 0 8 2 8 7zm2-5c7 0 8-4 8-7-5 0-8 2-8 7zm-2-4c-6 0-7-4-7-7 5 0 7 2 7 7zm1-6c-3-3-2-5 0-5 2 0 3 2 0 5z"/>',
  flour:
    '<path fill="#ede0b8" d="m11 5 10 0-2 6c6 4 8 15 3 17H10c-5-2-3-13 3-17z"/><path d="M11 11h10M13 20h6M16 17v7" fill="none"/>',
  bread:
    '<path fill="#dba458" d="M4 21c-2-9 5-16 14-15 9 1 13 10 8 17-5 4-17 4-22-2z"/><path stroke="#fae0a0" d="m10 11-2 7m9-9-3 10m10-6-3 7" fill="none"/>',
  pigs: '<ellipse cx="17" cy="17" rx="10" ry="8" fill="#dda3a0"/><path fill="#dda3a0" d="m10 11-2-6 7 4m8 1 4-5 1 9M11 23v5m11-5v5"/><ellipse cx="8" cy="18" rx="5" ry="4" fill="#efbbb3"/><path d="M6 17v2m4-2v2"/><circle cx="16" cy="14" r="1" fill="#352e27"/>',
  meat: '<path fill="#ca7770" d="M6 10c5-7 16-7 19 1 3 7-6 15-15 13-8-2-8-10-4-14z"/><path fill="#efd5b8" d="M9 11c3-3 9-4 12 0 2 4-4 10-9 9-5-1-6-5-3-9z"/><path fill="#af5852" d="M12 12c4-2 7 0 6 3-1 3-6 4-8 1z"/>',
  beer: '<path fill="#c58b33" d="M7 10h15v17H7z"/><path d="M22 12h5v10h-5" fill="none"/><path fill="#f4e5bc" d="M6 10V6h5V4h6v2h6v5z"/><path stroke="#ecc26c" d="M12 14v9m5-9v9"/>',
  coal: '<path fill="#596164" d="m3 24 3-11 8-7 9 3 6 15-10 4z"/><path stroke="#8f9896" d="m6 13 10 4 7-8m-7 8 3 11" fill="none"/>',
  iron: '<path fill="#929a96" d="m3 24 3-11 8-7 9 3 6 15-10 4z"/><path fill="#c78552" d="m8 15 6-4 4 7-7 4zm14-2 4 9-5 2-3-5z"/>',
  iron_bars:
    '<path fill="#bfc9c9" d="m4 18 4-7h15l5 7-5 6H8z"/><path fill="#829294" d="m4 18 4 6h15l5-6z"/><path d="M8 11v7h15v-7M4 18h24" fill="none"/>',
  tools:
    '<path stroke="#c39b63" stroke-width="4" d="m7 27 15-20m-4 20L7 6"/><path fill="#b7cac7" d="m14 6 7-3 7 7-4 4-6-5zm-9-2 9 2-3 9-6-3z"/>',
  weapons:
    '<path fill="#d2d9da" d="m22 3 4 1-1 5-14 14-4-4z"/><path stroke="#bf9854" stroke-width="3" d="m6 17 8 8m-8 1 5-5"/><path fill="#857d69" d="m19 16 10 3-2 9c-5 1-9-3-10-8z"/>',
  gold: '<ellipse cx="12" cy="24" rx="8" ry="3" fill="#d5a13a"/><path fill="#edbd4f" d="M4 20h16v4c0 4-16 4-16 0z"/><ellipse cx="12" cy="20" rx="8" ry="3" fill="#f6d778"/><circle cx="22" cy="12" r="8" fill="#f1c653"/><path stroke="#b5812c" d="M22 7v10m-3-7h6m-6 4h6"/>',
};

/** Small outlined vectors remain sharp at all interface resolutions. */
export function resourceIcon(good: Good): string {
  return (
    '<svg class="resource-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg"><g stroke="#4d4030" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">' +
    drawings[good] +
    '</g></svg>'
  );
}
