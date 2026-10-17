import { test, expect } from './helpers/test.mjs';

// Exercise the shipped Tone graph. Faults and observations stay at the browser
// AudioContext boundary; the game needs no production fault switches.
test.use({
  launchOptions: {
    args: [
      '--enable-webgl',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-accelerated-2d-canvas',
    ],
  },
});
test.setTimeout(90000);

async function boot(page, { failure = null, liveFrames = false } = {}) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(
    ({ failure, liveFrames }) => {
      const frame = window.requestAnimationFrame.bind(window);
      window.audioEvidence = { attempts: 0, contexts: [], taps: [], loops: [], frames: 0 };
      window.requestAnimationFrame = (callback) => {
        if (!liveFrames) {
          window.audioFrame = callback;
          return 0;
        }
        return frame((time) => {
          audioEvidence.frames++;
          callback(time);
        });
      };
      localStorage.setItem(
        'settlers.prefs',
        JSON.stringify({
          quality: 0.75,
          reducedMotion: true,
          musVol: 0.21,
          sfxVol: 0.57,
          ambVol: 0.31,
        }),
      );
      const NativeContext = window.AudioContext;
      let failed = false;
      for (const [method, fault] of [
        ['createGain', 'context-node'],
        ['createDynamicsCompressor', 'mixer'],
        ['resume', 'resume'],
      ]) {
        const original = NativeContext.prototype[method];
        NativeContext.prototype[method] = function (...args) {
          if (failure === fault && !failed) {
            failed = true;
            const error = new DOMException('Injected native audio failure', 'NotAllowedError');
            if (method === 'resume') return Promise.reject(error);
            throw error;
          }
          return original.apply(this, args);
        };
      }
      window.AudioContext = new Proxy(NativeContext, {
        construct(target, args, newTarget) {
          audioEvidence.attempts++;
          if (failure === 'constructor' && !failed) {
            failed = true;
            throw new Error('Injected native audio constructor failure');
          }
          const context = Reflect.construct(target, args, newTarget);
          audioEvidence.contexts.push(context);
          return context;
        },
      });
      const connect = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (destination, ...args) {
        const result = connect.call(this, destination, ...args);
        if (destination === this.context.destination) {
          const analyser = this.context.createAnalyser();
          analyser.fftSize = 2048;
          connect.call(this, analyser);
          audioEvidence.taps.push({ context: this.context, analyser });
        }
        return result;
      };
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        if (this.loop) {
          const entry = { node: this, ended: false };
          audioEvidence.loops.push(entry);
          this.addEventListener('ended', () => (entry.ended = true), { once: true });
        }
        return start.apply(this, args);
      };
    },
    { failure, liveFrames },
  );
  await page.goto('/tests/game.html?seed=2024');
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 60000 });
  // A held animation frame must not also hold the assertion's polling clock.
  await expect.poll(() => page.evaluate(() => !!window.productionArtPreview?.game)).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-renderer', 'pixi');
  expect(await page.evaluate(() => audioEvidence.attempts)).toBe(0);
  await page.locator('#startb').click();
  return errors;
}

async function ready(page) {
  await expect
    .poll(() => page.evaluate(() => productionArtPreview.game.AC?.state), { timeout: 15000 })
    .toBe('running');
  await page.evaluate(async () => {
    await productionArtPreview.game.initAudio();
    await productionArtPreview.game.initAudio();
  });
}

async function menu(page) {
  if (!(await page.locator('#utility').evaluate((element) => element.open)))
    await page.locator('#utility summary').click();
}

async function outputPeak(page) {
  return page.evaluate(() => {
    let peak = 0;
    for (const { analyser, context } of audioEvidence.taps) {
      if (context.state !== 'running') continue;
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    }
    return peak;
  });
}

async function expectCue(page) {
  await page.evaluate(() => productionArtPreview.game.SND.fail());
  await expect.poll(() => outputPeak(page), { intervals: [20, 50, 100] }).toBeGreaterThan(0.00001);
}

async function summary(page) {
  return page.evaluate(() => ({
    attempts: audioEvidence.attempts,
    contexts: audioEvidence.contexts.map((context) => context.state),
    loops: audioEvidence.loops.filter(
      ({ node, ended }) => !ended && node.context.state !== 'closed',
    ).length,
    notices: productionArtPreview.game.msgs.filter(({ t }) => /Audio unavailable/.test(t)).length,
    preferences: [productionArtPreview.game.musVol, productionArtPreview.game.sfxVol],
  }));
}

for (const failure of ['constructor', 'context-node', 'mixer', 'resume']) {
  test(`native ${failure} failure stays nonblocking and controls retry one clean graph`, async ({
    page,
  }) => {
    // Keep one case on the real RAF loop so visibility of the notice and economy
    // progress are observed without manually drawing a frame or stepping time.
    const liveFrames = failure === 'constructor';
    const errors = await boot(page, { failure, liveFrames });
    if (liveFrames) {
      await expect(page.locator('#msgs')).toContainText('Audio unavailable', { timeout: 15000 });
      const before = await page.evaluate(() => ({
        time: productionArtPreview.game.state.time,
        frames: audioEvidence.frames,
      }));
      await expect
        .poll(() => page.evaluate(() => productionArtPreview.game.state.time))
        .toBeGreaterThan(before.time);
      expect(await page.evaluate(() => audioEvidence.frames)).toBeGreaterThan(before.frames);
    } else {
      await expect
        .poll(() =>
          page.evaluate(() => {
            productionArtPreview.game.hudTick();
            return document.getElementById('msgs').textContent;
          }),
        )
        .toContain('Audio unavailable');
    }
    await expect
      .poll(() => page.evaluate(() => audioEvidence.contexts.every((c) => c.state === 'closed')))
      .toBe(true);
    expect((await summary(page)).notices).toBe(1);
    const attempts = (await summary(page)).attempts;
    await page.evaluate(() => {
      const game = productionArtPreview.game;
      game.SND.ui();
      game.SND.fanfare();
    });
    expect((await summary(page)).attempts).toBe(attempts);
    await page.screenshot({ path: test.info().outputPath(`${failure}-notice.png`) });
    await menu(page);
    await page.locator('#mute').click();
    await page.locator('#mute').click();
    await ready(page);
    await page.evaluate(() => {
      const game = productionArtPreview.game;
      game.state.paused = true;
      game.setMusicVol(false);
      game.setAmbVol(0);
    });
    await expectCue(page);
    const result = await summary(page);
    expect(result.contexts.filter((state) => state === 'running')).toHaveLength(1);
    expect(result.contexts.filter((state) => state !== 'closed')).toHaveLength(1);
    expect(result.preferences).toEqual([0.21, 0.57]);
    expect(result.notices).toBe(1);
    expect(errors).toEqual([]);
    await test.info().attach('native-audio-evidence', {
      body: JSON.stringify(result, null, 2),
      contentType: 'application/json',
    });
  });
}

test('native context loss during play reports automatically and controls restore audible output', async ({
  page,
}) => {
  const errors = await boot(page, { liveFrames: true });
  await ready(page);
  const before = await page.evaluate(() => ({
    time: productionArtPreview.game.state.time,
    frames: audioEvidence.frames,
  }));
  await page.evaluate(() => audioEvidence.contexts[0].close());
  // No startup, control or manual frame call may be needed to discover failure.
  await expect(page.locator('#msgs')).toContainText('Audio unavailable', { timeout: 15000 });
  await expect
    .poll(() => page.evaluate(() => productionArtPreview.game.state.time))
    .toBeGreaterThan(before.time);
  expect(await page.evaluate(() => audioEvidence.frames)).toBeGreaterThan(before.frames);
  expect((await summary(page)).notices).toBe(1);
  await page.screenshot({ path: test.info().outputPath('playback-loss-notice.png') });
  await menu(page);
  await page.locator('#mute').click();
  await page.locator('#mute').click();
  await ready(page);
  await page.evaluate(() => {
    const game = productionArtPreview.game;
    game.state.paused = true;
    game.setMusicVol(false);
    game.setAmbVol(0);
  });
  await expectCue(page);
  const result = await summary(page);
  expect(result.contexts).toEqual(['closed', 'running']);
  expect(result.notices).toBe(1);
  expect(result.preferences).toEqual([0.21, 0.57]);
  expect(errors).toEqual([]);
  await test.info().attach('native-playback-loss-evidence', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
});

test('startup, settings, pause, speed, world replacement and background recovery share one graph', async ({
  page,
}) => {
  const errors = await boot(page);
  await ready(page);
  const initial = await summary(page);
  expect(initial.contexts).toEqual(['running']);
  expect(initial.preferences).toEqual([0.21, 0.57]);
  expect(initial.loops).toBeGreaterThan(0);
  await page.evaluate(() => (productionArtPreview.game.state.paused = true));
  await menu(page);
  await page.locator('#mixb').click();
  await expect(page.locator('#mix')).toBeVisible();
  await page.locator('#speedpref').selectOption('8');
  await page.locator('#musicpref').uncheck();
  await page.locator('#mutepref').check();
  await page.locator('#mutepref').uncheck();
  await page.locator('#musicpref').check();
  for (const [id, value] of [
    ['musvol', '29'],
    ['sfxvol', '63'],
    ['ambvol', '45'],
  ]) {
    await page.locator(`#${id}`).evaluate((input, value) => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  }
  await ready(page);
  expect(
    await page.evaluate(() => ({
      context: productionArtPreview.game.AC.state,
      paused: productionArtPreview.game.state.paused,
      speed: productionArtPreview.game.state.speed,
    })),
  ).toEqual({ context: 'running', paused: true, speed: 8 });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const prefs = JSON.parse(localStorage.getItem('settlers.prefs'));
        return [prefs.musVol, prefs.sfxVol, prefs.ambVol, prefs.muted, prefs.music];
      }),
    )
    .toEqual([0.29, 0.63, 0.45, false, true]);
  await page.screenshot({ path: test.info().outputPath('audio-settings.png') });
  await page.keyboard.press('Escape');

  // These are real browser lifecycle handlers and native suspend/resume calls.
  // Dispatching page lifecycle events makes rapid transition order reproducible
  // in headless Chromium, which otherwise keeps all tabs visible.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect
    .poll(() => page.evaluate(() => productionArtPreview.game.AC.state))
    .toBe('suspended');
  await page.evaluate(() => {
    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pageshow'));
    const game = productionArtPreview.game;
    game.setMusicVol(false);
    game.setMusicVol(true);
    game.setMuted(true);
    game.setMuted(false);
  });
  await ready(page);
  expect((await summary(page)).loops).toBe(initial.loops);

  const replacement = await page.evaluate(() => {
    const game = productionArtPreview.game;
    const context = game.AC;
    game.setMusicVol(false);
    game.setAmbVol(0);
    const before = game.exportSave();
    const rng = game.SR.getState();
    game.SND.place();
    game.SND.chainRecovered(10, 10);
    const soundUnchanged = game.exportSave() === before && game.SR.getState() === rng;
    const checkpoint = game.saveCheckpoint('Audio continuation');
    game.resetColony(42, 'Audio replacement');
    const newSeed = game.seed;
    game.loadCheckpoint(checkpoint.id);
    return {
      soundUnchanged,
      newSeed,
      continued: game.exportSave() === before,
      sameContext: game.AC === context,
    };
  });
  expect(replacement).toEqual({
    soundUnchanged: true,
    newSeed: 42,
    continued: true,
    sameContext: true,
  });
  await expectCue(page);
  // Tone NoiseSynth also uses looped buffers for finite cues; wait for their
  // scheduled ends before comparing the continuous ambient graph.
  await expect.poll(async () => (await summary(page)).loops).toBe(initial.loops);
  const final = await summary(page);
  expect(final.attempts).toBe(1);
  expect(final.contexts).toEqual(['running']);
  expect(final.loops).toBe(initial.loops);
  expect(final.notices).toBe(0);
  expect(errors).toEqual([]);
  await test.info().attach('whole-game-audio-evidence', {
    body: JSON.stringify({ initial, final, replacement }, null, 2),
    contentType: 'application/json',
  });
});
