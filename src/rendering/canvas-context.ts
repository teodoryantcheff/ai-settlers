/** Distinguish unavailable graphics from a recoverable artwork-pack error. */
export class CanvasContextError extends Error {}

/** Obtain a real context or stop through the caller's graphics-failure boundary.
 * During assembly there may be no live reporter yet; bootstrap displays the error.
 */
export function requireCanvas2D(
  canvas: HTMLCanvasElement,
  reportFailure?: (reason: string) => void,
  settings?: CanvasRenderingContext2DSettings,
): CanvasRenderingContext2D {
  let context: CanvasRenderingContext2D | null;
  try {
    context = canvas.getContext('2d', settings);
  } catch (cause) {
    const error = new CanvasContextError('Canvas 2D context is unavailable', { cause });
    reportFailure?.(error.message);
    throw error;
  }
  if (context) return context;
  const error = new CanvasContextError('Canvas 2D context is unavailable');
  reportFailure?.(error.message);
  throw error;
}
