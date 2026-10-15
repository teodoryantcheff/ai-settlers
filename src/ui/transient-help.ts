interface HelpBinding {
  trigger: HTMLElement;
  popup: HTMLElement;
  overTrigger: boolean;
  overPopup: boolean;
}
export interface TransientHelp {
  bind: (trigger: HTMLElement, popup: HTMLElement) => () => void;
  dismiss: () => void;
  destroy: () => void;
}

/** Passive DOM help shares one hover/focus lifetime without owning game state. */
export function createTransientHelp(options: { canShow: () => boolean }): TransientHelp {
  let active: HelpBinding | null = null;
  let suppressed: HelpBinding | null = null;
  let leaveTimer: ReturnType<typeof setTimeout> | null = null;
  let nextId = 0;
  const cleanups = new Set<() => void>();
  function cancelLeave() {
    if (leaveTimer !== null) clearTimeout(leaveTimer);
    leaveTimer = null;
  }
  function interacting(binding: HelpBinding) {
    return (
      binding.overTrigger ||
      binding.overPopup ||
      binding.trigger.contains(document.activeElement) ||
      binding.popup.contains(document.activeElement)
    );
  }
  function hide() {
    cancelLeave();
    if (active) active.popup.hidden = true;
    active = null;
  }
  function dismiss() {
    suppressed = active;
    hide();
  }
  function show(binding: HelpBinding) {
    if (suppressed && !interacting(suppressed)) suppressed = null;
    cancelLeave();
    if (
      suppressed === binding ||
      !options.canShow() ||
      !binding.trigger.isConnected ||
      binding.trigger.closest('[hidden],.hidden,[inert]')
    )
      return;
    if (active !== binding) hide();
    active = binding;
    const { trigger, popup } = binding;
    popup.hidden = false;
    const rect = trigger.getBoundingClientRect();
    const width = popup.getBoundingClientRect().width;
    const height = popup.getBoundingClientRect().height;
    const gap = 6;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left));
    const below = rect.bottom + gap;
    const top =
      below + height <= window.innerHeight - 8 ? below : Math.max(8, rect.top - height - gap);
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
  }
  function leave(binding: HelpBinding) {
    cancelLeave();
    leaveTimer = setTimeout(() => {
      leaveTimer = null;
      if (interacting(binding)) return;
      if (active === binding) hide();
      if (suppressed === binding) suppressed = null;
    }, 120);
  }
  function bind(trigger: HTMLElement, popup: HTMLElement) {
    if (!popup.id) popup.id = 'transient-help-' + ++nextId;
    popup.hidden = true;
    const description = trigger.getAttribute('aria-describedby');
    trigger.setAttribute('aria-describedby', [description, popup.id].filter(Boolean).join(' '));
    const binding: HelpBinding = { trigger, popup, overTrigger: false, overPopup: false };
    const enterTrigger = () => {
      binding.overTrigger = true;
      show(binding);
    };
    const leaveTrigger = () => {
      binding.overTrigger = false;
      leave(binding);
    };
    const enterPopup = () => {
      binding.overPopup = true;
      cancelLeave();
    };
    const leavePopup = () => {
      binding.overPopup = false;
      leave(binding);
    };
    const focus = () => show(binding);
    const blur = () => leave(binding);
    const activate = () => {
      if (active === binding) dismiss();
    };
    const contain = (event: Event) => event.stopPropagation();
    trigger.addEventListener('pointerenter', enterTrigger);
    trigger.addEventListener('pointerleave', leaveTrigger);
    trigger.addEventListener('focusin', focus);
    trigger.addEventListener('focusout', blur);
    trigger.addEventListener('click', activate);
    popup.addEventListener('pointerenter', enterPopup);
    popup.addEventListener('pointerleave', leavePopup);
    popup.addEventListener('focusin', focus);
    popup.addEventListener('focusout', blur);
    popup.addEventListener('pointerdown', contain);
    popup.addEventListener('mousedown', contain);
    popup.addEventListener('click', contain);
    const unbind = () => {
      if (active === binding) hide();
      if (suppressed === binding) suppressed = null;
      trigger.removeEventListener('pointerenter', enterTrigger);
      trigger.removeEventListener('pointerleave', leaveTrigger);
      trigger.removeEventListener('focusin', focus);
      trigger.removeEventListener('focusout', blur);
      trigger.removeEventListener('click', activate);
      popup.removeEventListener('pointerenter', enterPopup);
      popup.removeEventListener('pointerleave', leavePopup);
      popup.removeEventListener('focusin', focus);
      popup.removeEventListener('focusout', blur);
      popup.removeEventListener('pointerdown', contain);
      popup.removeEventListener('mousedown', contain);
      popup.removeEventListener('click', contain);
      if (description) trigger.setAttribute('aria-describedby', description);
      else trigger.removeAttribute('aria-describedby');
      cleanups.delete(unbind);
    };
    cleanups.add(unbind);
    return unbind;
  }
  function keydown(event: KeyboardEvent) {
    if (!active || event.key !== 'Escape' || event.defaultPrevented) return;
    if (!options.canShow()) {
      dismiss();
      return;
    }
    dismiss();
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function checkFocus() {
    if (suppressed && !interacting(suppressed)) suppressed = null;
    if (active && !options.canShow()) dismiss();
  }
  function scroll(event: Event) {
    if (!active || active.popup.contains(event.target as Node)) return;
    // Native focus can scroll a clipped resource row before its scroll event.
    // Keep that keyboard description and follow its now-visible trigger.
    if (active.trigger.contains(document.activeElement)) show(active);
    else dismiss();
  }
  window.addEventListener('keydown', keydown, true);
  window.addEventListener('resize', dismiss);
  document.addEventListener('focusin', checkFocus);
  document.addEventListener('scroll', scroll, true);
  return {
    bind,
    dismiss,
    destroy() {
      hide();
      for (const cleanup of [...cleanups]) cleanup();
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('resize', dismiss);
      document.removeEventListener('focusin', checkFocus);
      document.removeEventListener('scroll', scroll, true);
    },
  };
}
