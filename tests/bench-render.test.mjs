import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { benchOptions, isSoftwareRenderer, summarize } from '../scripts/bench-render-helpers.mjs';

test('the benchmark measures a 20-minute colony at every zoom by default', () => {
  assert.deepEqual(benchOptions([]), {
    minutes: 20,
    zooms: null,
    modes: ['running', 'paused'],
    speed: 1,
    windowMs: 3000,
    seed: 2024,
    width: 1920,
    height: 1080,
    quality: 1,
    profile: [],
    port: 8790,
  });
  assert.deepEqual(
    benchOptions(['--zooms', '3,5', '--profile', '3', '--quality', '0.75', '--size', '1280x720']),
    {
      ...benchOptions([]),
      zooms: [3, 5],
      profile: [3],
      quality: 0.75,
      width: 1280,
      height: 720,
    },
  );
});

test('option mistakes are rejected before the colony grows', () => {
  for (const [argv, message] of [
    [['--zoom', '3'], /--zoom\b/],
    [['--zooms'], /--zooms/],
    [['--zooms', '1.5'], /--zooms/],
    [['--modes', 'moving'], /--modes/],
    [['--quality', '0.5'], /--quality/],
    [['--speed', '3'], /--speed/],
    [['--zooms', '3', '--profile', '4'], /--profile/],
    [['--modes', 'paused', '--profile', '3'], /--profile/],
    [['--size', 'wide'], /--size/],
    [['--ms', '0'], /--ms/],
    [['--minutes', '-1'], /--minutes/],
    [['--port', 'http'], /--port/],
  ])
    assert.throws(() => benchOptions(argv), message, argv.join(' '));
});

test('software WebGL renderers are told apart from hardware GPUs', () => {
  for (const name of [
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    'ANGLE (Mesa, llvmpipe (LLVM 19.1.1, 256 bits), OpenGL 4.5)',
    'softpipe',
    'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)',
  ])
    assert.equal(isSoftwareRenderer(name), true, name);
  assert.equal(
    isSoftwareRenderer('ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)'),
    false,
  );
});

test('a measurement window reports per-frame CPU, GPU and upload costs', () => {
  const sample = {
    // Two callbacks share the first frame; three frames over 200 ms.
    frames: [
      [0, 4],
      [0, 2],
      [100, 10],
      [200, 8],
    ],
    gpu: [3, 1, 2],
    gl: {
      drawElements: { calls: 9, bytes: 0 },
      drawArrays: { calls: 3, bytes: 0 },
      drawElementsInstanced: { calls: 2, bytes: 0 },
      drawArraysInstanced: { calls: 1, bytes: 0 },
      drawRangeElements: { calls: 3, bytes: 0 },
      bufferData: { calls: 1, bytes: 2048 },
      bufferSubData: { calls: 4, bytes: 4096 },
      texImage2D: { calls: 1, bytes: 0 },
      texSubImage2D: { calls: 5, bytes: 0 },
    },
    phases: { draw: 15, step: 3, drawMini: 1.5, hudTick: 0.9 },
    stats: { nativeSprites: 7066, nativeGraphics: 2503, graphicsBuilds: 130 },
    z: 0.55,
  };
  assert.deepEqual(summarize(sample, { graphicsBuilds: 100 }), {
    scale: 0.55,
    fps: 10,
    cpuMean: 8,
    cpuP95: 10,
    drawMs: 5,
    stepMs: 1,
    miniMs: 0.5,
    hudMs: 0.3,
    gpuP50: 2,
    gpuP95: 3,
    sprites: 7066,
    graphics: 2503,
    graphicsBuilds: 10,
    drawCalls: 6,
    uploadKB: 2,
    texUploads: 2,
  });
});

test('the benchmark URL pins the cosmetic clock while ordinary play keeps it running', () => {
  const { createGame } = createRequire(import.meta.url)('./helpers/game.cjs');
  const world = (search) => createGame({ modules: ['world'], search }).game;
  assert.equal(world('?seed=2024&renderbench').TESTMODE, true);
  assert.equal(world('?seed=2024').TESTMODE, false);
});
