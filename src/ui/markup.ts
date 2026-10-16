import { resourceIcon } from './resource-icons.ts';
import type { Good, Inventory } from '../types.ts';

/** Only use for fixed icons or fragments already produced by an escaping template. */
class TrustedMarkup {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
}
export function trusted(value: string) {
  return new TrustedMarkup(value);
}

/** The single text/attribute escape used at the interface markup boundary. */
export function escapeMarkup(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}

/** Interpolations are text by default, including inside quoted attributes. */
export function html(parts: TemplateStringsArray, ...values: unknown[]): string {
  return parts.reduce((result, part, index) => {
    if (!index) return part;
    const value = values[index - 1];
    return result + (value instanceof TrustedMarkup ? value.value : escapeMarkup(value)) + part;
  }, '');
}

export interface GoodsFormat {
  separator?: string;
  empty?: string;
  lowerCase?: boolean;
  positiveOnly?: boolean;
  omitZero?: boolean;
  allowed?: Readonly<Inventory>;
  /** Simulation seconds covered; rates are displayed per simulation minute. */
  elapsed?: number;
  icons?: boolean;
  className?: string;
}

/** Shared quantity/name formatting for costs, inventory and measured rates. */
export function formatGoods(
  goods: Readonly<Record<Good, { name: string }>>,
  inventory: Readonly<Inventory> | undefined,
  options: GoodsFormat = {},
): string {
  if (options.elapsed !== undefined && options.elapsed <= 0) return '—';
  const parts: string[] = [];
  for (const [key, amount] of Object.entries(inventory || {})) {
    const good = key as Good;
    if (options.allowed && !options.allowed[good]) continue;
    if (options.positiveOnly && amount <= 0) continue;
    if (options.omitZero && !amount) continue;
    const quantity =
      options.elapsed === undefined ? amount : ((amount / options.elapsed) * 60).toFixed(1);
    const name = options.lowerCase ? goods[good].name.toLowerCase() : goods[good].name;
    if (options.icons || options.className) {
      const entry = html`${trusted(options.icons ? resourceIcon(good) : '')}${quantity} ${name}`;
      parts.push(
        options.className
          ? html`<span class="${options.className}">${trusted(entry)}</span>`
          : entry,
      );
    } else parts.push(quantity + ' ' + name);
  }
  const separator = options.separator ?? ' + ';
  const empty = options.empty ?? '';
  return options.icons || options.className
    ? parts.join(escapeMarkup(separator)) || escapeMarkup(empty)
    : parts.join(separator) || empty;
}
