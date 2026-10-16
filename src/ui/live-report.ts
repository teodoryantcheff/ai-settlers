/** The report chooses its stable keys, authored disclosure default and focus fallback. */
export interface LiveReportPolicy {
  focusAttribute: string;
  disclosureAttribute: string;
  disclosureDefault: 'markup' | 'closed';
  fallback: (element: HTMLElement) => HTMLElement | null;
}

/** Replace changing evidence, retaining disclosure choices and a useful native focus destination. */
export function createLiveReportUpdater(policy: LiveReportPolicy) {
  let rendered = new WeakMap<HTMLElement, string>();
  const expanded = new Map<string, boolean>();
  function keyed<T extends HTMLElement>(element: HTMLElement, attribute: string, key: string) {
    return [...element.querySelectorAll<T>(`[${attribute}]`)].find(
      (node) => node.getAttribute(attribute) === key,
    );
  }
  function update(element: HTMLElement | null, html: string) {
    if (!element || rendered.get(element) === html) return;
    const active = document.activeElement as HTMLElement | null;
    const hadFocus = element.contains(active);
    const key = hadFocus && active ? active.getAttribute(policy.focusAttribute) : null;
    for (const details of element.querySelectorAll<HTMLDetailsElement>(
      `details[${policy.disclosureAttribute}]`,
    )) {
      const key = details.getAttribute(policy.disclosureAttribute);
      if (key !== null) expanded.set(key, details.open);
    }
    element.innerHTML = html;
    rendered.set(element, html);
    for (const details of element.querySelectorAll<HTMLDetailsElement>(
      `details[${policy.disclosureAttribute}]`,
    )) {
      const key = details.getAttribute(policy.disclosureAttribute);
      const remembered = key === null ? undefined : expanded.get(key);
      if (remembered !== undefined) details.open = remembered;
      else if (policy.disclosureDefault === 'closed') details.open = false;
    }
    if (!hadFocus) return;
    const control = key ? keyed(element, policy.focusAttribute, key) : null;
    const target =
      control && !control.matches(':disabled') ? control : policy.fallback(element) || element;
    if (target && !target.matches(':disabled')) {
      if (!target.matches('button,input,select,textarea,a[href],summary,[tabindex]'))
        target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
  }
  return Object.assign(update, {
    reset() {
      expanded.clear();
      rendered = new WeakMap();
    },
  });
}
