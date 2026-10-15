/** Shared bell color; callers retain their own release tails and routing. */
export function bellOptions(
  velocity: number,
  duration: number,
  release: number,
  modulationRelease: number,
) {
  return {
    // Pinned Tone FM voices attenuate carrier/modulator by 10 dB, then scale
    // both by velocity. Normalize brightness while retaining the softer output.
    volume: 5,
    harmonicity: 2.51,
    modulationIndex: 0.14 / (velocity * Math.pow(10, -0.5)),
    oscillator: { type: 'sine' as const },
    modulation: { type: 'sine' as const },
    envelope: { attack: 0.004, decay: duration, sustain: 0, release },
    modulationEnvelope: {
      attack: 0.004,
      decay: duration * 0.4,
      sustain: 0,
      release: modulationRelease,
    },
  };
}
