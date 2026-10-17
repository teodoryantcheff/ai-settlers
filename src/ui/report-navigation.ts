/** Reveal explicit drilldowns inside their scrollable report, preserving the root map viewport. */
export function revealReportHeading(host: HTMLElement, heading: HTMLElement | null | undefined) {
  if (!heading) return;
  heading.focus({ preventScroll: true });
  const padding = parseFloat(getComputedStyle(host).paddingTop) || 0;
  host.scrollTop +=
    heading.getBoundingClientRect().top - host.getBoundingClientRect().top - padding;
}
