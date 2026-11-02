// End-to-end browser test (headless Chromium via Playwright).
//  - navigates every menu, takes screenshots at desktop / 4K / tablet / phone sizes
//  - plays songs with an in-page bot that presses the real key bindings at note times and checks
//    that the judgement pipeline (input timestamps -> audio clock -> rules) scores them as hits
//  - exercises pause / resume / restart, settings persistence and touch input
// Usage: npm run build && npm run e2e   (writes screenshots to e2e-out/)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium, devices;
try { ({ chromium, devices } = require('playwright')); } catch { ({ chromium, devices } = require('@playwright/test')); }

const OUT = process.env.E2E_OUT || 'e2e-out';
mkdirSync(OUT, { recursive: true });
const PORT = 4318;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => { server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); }); setTimeout(res, 6000); });
const URL = `http://localhost:${PORT}/`;
const results = [];
const log = (name, ok, info = '') => { results.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--enable-unsafe-swiftshader'] });

async function start(page) {
  await page.goto(URL);
  await page.waitForSelector('.press-start', { timeout: 15000 });
  await page.waitForTimeout(400);
}

async function bot(page, { method = 'inject', swipeMode = 'chord', maxSeconds = 999, jitterMs = 0 } = {}) {
  return page.evaluate(async ({ method, swipeMode, maxSeconds, jitterMs }) => {
    const g = window.__fsGame;
    const lanes = ['KeyA', 'KeyS', 'KeyD'];
    const dirs = { up: 'KeyI', left: 'KeyJ', down: 'KeyK', right: 'KeyL' };
    const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }));
    const notes = g.session.notes;
    const scheduled = new Set();
    const t0 = performance.now();
    const later = (perfTs, fn) => setTimeout(fn, Math.max(0, perfTs - performance.now()));
    const pendingUp = [null, null, null];
    return await new Promise((resolve) => {
      const tick = () => {
        const st = g.songTime;
        for (const n of notes) {
          if (scheduled.has(n.id)) continue;
          if (n.t - st > 0.3) break;
          scheduled.add(n.id);
          const jitter = jitterMs ? (Math.random() * 2 - 1) * jitterMs : 0;
          const ts = g.perfAt(n.t) + jitter;
          if (method === 'keys') {
            // real DOM keyboard events, dispatched as close to the note time as the page allows
            later(ts, () => {
              if (n.type === 'swipe') { key('keydown', lanes[n.lane]); key('keydown', dirs[n.dir]); setTimeout(() => { key('keyup', lanes[n.lane]); key('keyup', dirs[n.dir]); }, 30); }
              else { key('keydown', lanes[n.lane]); setTimeout(() => key('keyup', lanes[n.lane]), n.type === 'hold' ? n.dur * 1000 + 10 : 35); }
            });
          } else {
            // exact-timestamp injection through the controller's input handlers. Inputs for a lane are
            // delivered in order: any pending release on that lane is flushed before the next press.
            const touch = method === 'touch';
            const flush = (lane) => { const p = pendingUp[lane]; if (p) { clearTimeout(p.timer); pendingUp[lane] = null; g.testInput('up', lane, null, p.ts); } };
            const scheduleUp = (lane, upTs) => { pendingUp[lane] = { ts: upTs, timer: later(upTs, () => { if (pendingUp[lane]?.ts === upTs) { pendingUp[lane] = null; g.testInput('up', lane, null, upTs); } }) }; };
            flush(n.lane);
            if (n.type === 'swipe') {
              if (touch) { g.testInput('touch', n.lane, n.dir, ts); g.testInput('swipe', n.lane, n.dir, ts + 6); }
              else if (swipeMode === 'chord') { g.testInput('down', n.lane, null, ts); g.testInput('dir', n.lane, n.dir, ts + 8); }
              scheduleUp(n.lane, ts + 40);
            } else if (n.type === 'hold' && n.path && n.path.length) {
              // switch / rail hold: move to each new lane at its transition time
              g.testInput(touch ? 'touch' : 'down', n.lane, null, ts);
              let cur = n.lane;
              const pts = [...n.path].sort((a, b) => a.t - b.t);
              for (const p of pts) {
                const from = cur, to = p.lane;
                const at = g.perfAt(p.t + (p.slide || 0) * 0.5);
                later(at - 20, () => {
                  if (touch) g.testInput('slide', from, null, at, to);
                  else { flush(to); g.testInput('down', to, null, at); g.testInput('up', from, null, at + 25); }
                });
                cur = to;
              }
              const endLane = cur;
              later(g.perfAt(n.t + n.dur) - 30, () => scheduleUp(endLane, g.perfAt(n.t + n.dur) + 5));
            } else {
              g.testInput(touch ? 'touch' : 'down', n.lane, null, ts);
              scheduleUp(n.lane, n.type === 'hold' ? g.perfAt(n.t + n.dur) + 5 : ts + 40);
            }
          }
        }
        const done = g.isFinished || (performance.now() - t0) / 1000 > maxSeconds;
        if (done) { setTimeout(() => resolve({ byType: g.session.result().byType, counts: g.session.counts, score: g.session.score, max: g.session.max, total: notes.length, judged: g.session.judgedCount, failed: g.session.failed, deltas: notes.filter((n) => n.delta !== undefined).map((n) => n.delta) }), 300); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, { method, swipeMode, maxSeconds, jitterMs });
}

try {
  // ---------------- desktop 1920x1080 ----------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await start(page);
    await page.screenshot({ path: `${OUT}/01-splash-1080p.png` });
    await page.keyboard.press('Enter');
    await page.waitForSelector('.home', { timeout: 8000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/02-home-1080p.png` });
    const songCount = await page.$$eval('.car-card', (els) => els.length);
    log('home shows all songs in carousel', songCount === 11, `${songCount} cards`);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(700);
    await page.click('text=Song Library');
    await page.waitForSelector('.song-grid');
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/03-library-1080p.png` });
    await page.fill('.search input', 'funk');
    await page.waitForTimeout(300);
    const filtered = await page.$$eval('.song-card', (els) => els.length);
    log('library search filters', filtered > 0 && filtered < 11, `${filtered} results for "funk"`);
    await page.fill('.search input', '');
    await page.click('.segmented button:has-text("Name")');
    const firstTitle = await page.$eval('.song-card-title', (e) => e.textContent);
    log('library sort by name', firstTitle === 'Faixa Rosa', `first = ${firstTitle}`);
    await page.click('.song-card:has-text("First Light") .song-card-main');
    await page.waitForSelector('.details');
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/04-details-1080p.png` });
    await page.click('.diff-card:has-text("Hard")');
    await page.click('.segmented button:has-text("Practice")');
    await page.click('.details-actions .play-big');
    await page.waitForSelector('.play canvas');
    await page.waitForFunction(() => window.__fsGame && window.__fsGame.songTime > -2, null, { timeout: 15000 });
    // real DOM keyboard events: mapping, multiple keys per lane, chords, key-repeat suppression
    const km = await page.evaluate(() => {
      const g = window.__fsGame, inp = g.input;
      const k = (type, code, repeat = false) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code, repeat, bubbles: true }));
      const out = [];
      k('keydown', 'KeyA'); out.push(inp.isPressed(0));
      k('keydown', 'ArrowLeft'); k('keyup', 'KeyA'); out.push(inp.isPressed(0));
      k('keyup', 'ArrowLeft'); out.push(!inp.isPressed(0));
      k('keydown', 'KeyS'); k('keydown', 'KeyD'); out.push(inp.isPressed(1) && inp.isPressed(2) && !inp.isPressed(0));
      k('keydown', 'KeyS', true); k('keyup', 'KeyS'); out.push(!inp.isPressed(1) && inp.isPressed(2));
      k('keyup', 'KeyD'); out.push(!inp.isPressed(2));
      k('keydown', 'KeyI'); k('keyup', 'KeyI'); out.push(!inp.isPressed(0) && !inp.isPressed(1) && !inp.isPressed(2));
      return out;
    });
    log('real keyboard events: lanes, alternate keys, chords, no key-repeat, swipe keys don\'t press lanes', km.every(Boolean), JSON.stringify(km));
    await page.keyboard.press('Escape');
    await page.waitForSelector('.pause-panel');
    await page.keyboard.press('KeyR');
    await page.waitForFunction(() => window.__fsGame && window.__fsGame.songTime > -2 && window.__fsGame.session.judgedCount === 0, null, { timeout: 15000 });
    const botP = bot(page, { maxSeconds: 30 });
    await page.waitForTimeout(18000);
    await page.screenshot({ path: `${OUT}/05-gameplay-1080p.png` });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/05b-gameplay-1080p.png` });
    const r = await botP;
    const hit = r.counts.perfectPlus + r.counts.perfect + r.counts.great;
    const mean = r.deltas.reduce((a, b) => a + b, 0) / Math.max(1, r.deltas.length);
    log('timing pipeline (Hard, first 30 s, exact timestamps): every note Perfect+', r.counts.miss === 0 && r.counts.perfectPlus === r.judged && hit > 30,
      `P+ ${r.counts.perfectPlus} P ${r.counts.perfect} G ${r.counts.great} M ${r.counts.miss}, mean |error| ${(r.deltas.reduce((a, b) => a + Math.abs(b), 0) / Math.max(1, r.deltas.length) * 1000).toFixed(2)} ms, mean ${(mean * 1000).toFixed(2)} ms`);
    // pause / resume
    await page.keyboard.press('Escape');
    await page.waitForSelector('.pause-panel');
    const tPaused = await page.evaluate(() => window.__fsGame.songTime);
    await page.waitForTimeout(800);
    const tPaused2 = await page.evaluate(() => window.__fsGame.songTime);
    await page.screenshot({ path: `${OUT}/06-pause-1080p.png` });
    log('pause freezes song time', Math.abs(tPaused2 - tPaused) < 0.001, `${tPaused.toFixed(3)} → ${tPaused2.toFixed(3)}`);
    await page.click('.pause-panel .btn-play');
    await page.waitForTimeout(3600);
    const tRes = await page.evaluate(() => window.__fsGame.songTime);
    log('resume continues from paused position', tRes > tPaused && tRes - tPaused < 1.0, `+${(tRes - tPaused).toFixed(3)} s after countdown`);
    // restart
    await page.keyboard.press('Escape');
    await page.waitForSelector('.pause-panel');
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(1500);
    const tRestart = await page.evaluate(() => window.__fsGame.songTime);
    log('restart begins the song again (lead-in)', tRestart < 0.5, `t = ${tRestart.toFixed(2)}`);
    const sources = await page.evaluate(() => window.__fsGame.session.judgedCount);
    log('restart resets the session', sources === 0);
    // full song with bot on Extreme in practice to reach results
    await page.keyboard.press('Escape');
    await page.click('text=Quit song');
    await page.waitForSelector('.details');
    await page.click('.diff-card:has-text("Extreme")');
    await page.click('.segmented button:has-text("Classic")');
    await page.click('.details-actions .play-big');
    await page.waitForFunction(() => window.__fsGame && window.__fsGame.songTime > -2, null, { timeout: 15000 });
    const full = await bot(page, { maxSeconds: 200, jitterMs: 15 });
    const fullHit = full.counts.perfectPlus + full.counts.perfect + full.counts.great;
    log('full song, Extreme, Classic (bot ±15 ms jitter): cleared without a miss', full.counts.miss === 0 && fullHit === full.total,
      `${fullHit}/${full.total} hits, P+ ${full.counts.perfectPlus}, score ${Math.round(full.score)}/${full.max}`);
    await page.waitForSelector('.results2', { timeout: 15000 });
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `${OUT}/07-results-1080p.png` });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('funkstars.profile.v1')));
    log('score saved to profile', !!saved?.bests?.['first-light']?.extreme?.score, `best ${saved?.bests?.['first-light']?.extreme?.score}`);
    log('achievements unlocked & saved', Object.keys(saved?.achievements ?? {}).length > 0, Object.keys(saved?.achievements ?? {}).join(', '));
    // settings persistence
    await page.goto(URL);
    await page.waitForSelector('.press-start');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.home');
    await page.click('[aria-label="Settings"]');
    await page.click('.tabs button:has-text("Gameplay")');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/08-settings-1080p.png` });
    await page.click('.tabs button:has-text("Controls")');
    await page.click('.keyrow:has-text("Left lane") .keycap >> nth=0');
    await page.keyboard.press('KeyF');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/08b-controls-1080p.png` });
    await page.reload();
    const keys = await page.evaluate(() => JSON.parse(localStorage.getItem('funkstars.settings.v1')).keys.lane0);
    log('key rebinding persists across reload', keys[0] === 'KeyF', JSON.stringify(keys));
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('funkstars.settings.v1')); s.keys.lane0 = ['KeyA', 'ArrowLeft']; localStorage.setItem('funkstars.settings.v1', JSON.stringify(s)); });
    await page.reload();
    await page.waitForSelector('.press-start');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.home');
    for (const [name, sel, file] of [['Progression', '.progress-grid', '09-progress'], ['Achievements', '.ach-grid', '10-achievements'], ['Studio', '.studio-grid', '11-studio']]) {
      await page.click(`.tile:has-text("${name}")`);
      await page.waitForSelector(sel);
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${OUT}/${file}-1080p.png` });
      await page.click('[aria-label="Back"]');
      await page.waitForSelector('.home');
    }
    // editor
    await page.click('.tile:has-text("Song Library")');
    await page.click('.song-card:has-text("Virou") .song-card-main');
    await page.click('text=Edit chart');
    await page.waitForSelector('.editor canvas');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/12-editor-1080p.png` });
    const before = await page.$eval('.panel-col p', (e) => e.textContent);
    await page.click('.tool:has-text("Tap")');
    const box = await page.$eval('.editor-timeline canvas', (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top }; });
    await page.mouse.click(box.x + 400, box.y + 22 + 72 + 58 * 1 + 29);
    await page.waitForTimeout(200);
    const after = await page.$eval('.panel-col:nth-child(2) p', (e) => e.textContent);
    log('editor: adding a note updates the chart', before !== after, `${after}`);
    await page.keyboard.press('Control+KeyZ');
    await page.waitForTimeout(200);
    const undone = await page.$eval('.panel-col:nth-child(2) p', (e) => e.textContent);
    log('editor: undo', undone !== after);
    // interactive tutorial: every note type, played through the real input handlers (keyboard path)
    await page.goto(URL);
    await page.waitForSelector('.press-start');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.home');
    await page.click('.tile:has-text("Tutorial")');
    await page.waitForFunction(() => window.__fsGame && window.__fsGame.songTime > -2 && window.__fsGame.session, null, { timeout: 20000 });
    const tutP = bot(page, { maxSeconds: 120 });
    await page.waitForFunction(() => window.__fsGame && window.__fsGame.songTime > 17.3, null, { timeout: 60000 });
    await page.screenshot({ path: `${OUT}/13-tutorial-1080p.png` });
    await page.waitForFunction(() => window.__fsGame && window.__fsGame.songTime > 44.6, null, { timeout: 60000 });
    await page.screenshot({ path: `${OUT}/13b-tutorial-switch-1080p.png` });
    await page.waitForFunction(() => window.__fsGame && window.__fsGame.songTime > 52.6, null, { timeout: 60000 });
    await page.screenshot({ path: `${OUT}/13c-tutorial-rail-1080p.png` });
    const tut = await tutP;
    log('tutorial (taps, half, micro, chords, holds, swipes, diagonals, switch & rail holds): all clean (keyboard)',
      tut.counts.miss === 0 && tut.counts.holdBreaks === 0, JSON.stringify(tut.byType) + ` P+ ${tut.counts.perfectPlus}`);
    log('no uncaught page errors (desktop)', errs.length === 0, errs.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ---------------- 4K (3840x2160 via 1920x1080 @2x) ----------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await start(page);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.home');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/20-home-4k.png` });
    await ctx.close();
  }
  // ---------------- 2560x1440 gameplay ----------------
  {
    const ctx = await browser.newContext({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await start(page);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.home');
    await page.click('.featured-actions .play-big');
    await page.waitForSelector('.details');
    await page.click('.diff-card:has-text("Extreme")');
    await page.click('.details-actions .play-big');
    await page.waitForFunction(() => window.__fsGame && window.__fsGame.songTime > 0, null, { timeout: 15000 });
    const p = bot(page, { maxSeconds: 40, jitterMs: 10 });
    await page.waitForTimeout(32000);
    await page.screenshot({ path: `${OUT}/21-gameplay-1440p.png` });
    const r = await p;
    log('real song (Moms Calling Funk, Extreme, 40 s) bot: no misses', r.counts.miss === 0 && r.counts.holdBreaks === 0, `P+ ${r.counts.perfectPlus} P ${r.counts.perfect} G ${r.counts.great} M ${r.counts.miss} holdBreaks ${r.counts.holdBreaks} ${JSON.stringify(r.byType)}`);
    await ctx.close();
  }
  // ---------------- 1366x768 laptop ----------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await ctx.newPage();
    await start(page);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.home');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUT}/30-home-laptop.png` });
    await ctx.close();
  }
  // ---------------- iPhone portrait (touch) ----------------
  for (const [label, dev, w, h] of [['iphone-portrait', 'iPhone 14 Pro Max', 430, 932], ['iphone-landscape', 'iPhone 14 Pro Max landscape', 932, 430], ['ipad', 'iPad Pro 11', 834, 1194]]) {
    const d = devices[dev] ?? { viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };
    const ctx = await browser.newContext({ ...d });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(URL);
    await page.waitForSelector('.press-start');
    await page.screenshot({ path: `${OUT}/40-${label}-splash.png` });
    await page.touchscreen.tap(100, 200);
    await page.waitForSelector('.home');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/41-${label}-home.png` });
    await page.tap('.featured-actions .play-big');
    await page.waitForSelector('.details');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/42-${label}-details.png` });
    await page.tap('.details-actions .segmented button:has-text("Practice")');
    await page.tap('.details-actions .play-big');
    await page.waitForFunction(() => window.__fsGame && window.__fsGame.songTime > 0, null, { timeout: 15000 });
    const tr = await bot(page, { method: 'touch', maxSeconds: 20, jitterMs: 10 });
    log(`${label}: touch pipeline (tap / hold / flick swipe) — no misses in 20 s`, tr.counts.miss === 0 && tr.judged > 5, `P+ ${tr.counts.perfectPlus} P ${tr.counts.perfect} G ${tr.counts.great} M ${tr.counts.miss}`);
    // real touch events through CDP: check that lanes register (timing is approximate in headless)
    await page.evaluate(() => window.__fsGame.pause());
    await page.waitForSelector('.pause-panel');
    await page.tap('.pause-panel .btn-glass:has-text("Restart")');
    await page.waitForFunction(() => window.__fsGame && window.__fsGame.songTime > -1.5 && window.__fsGame.session.judgedCount === 0, null, { timeout: 15000 });
    const cdp = await ctx.newCDPSession(page);
    const geo = await page.evaluate(() => { const c = document.querySelector('.game-canvas').getBoundingClientRect(); return { w: c.width, h: c.height }; });
    const notes = await page.evaluate(() => window.__fsGame.session.notes.filter((n) => n.t < 14).map((n) => ({ t: n.t, lane: n.lane, type: n.type, dir: n.dir, dur: n.dur })));
    const laneX = await page.evaluate(() => { const g = window.__fsGame; const r = g.renderer; return [r.xAt(-2 / 3, 0), r.xAt(0, 0), r.xAt(2 / 3, 0)]; });
    const y = geo.h * 0.8;
    let sent = 0;
    for (const n of notes) {
      const st = await page.evaluate(() => window.__fsGame.songTime);
      const wait = (n.t - st) * 1000 - 25; // CDP round trip compensation
      if (wait > 0) await page.waitForTimeout(wait);
      const x = laneX[n.lane];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      if (n.type === 'swipe') {
        const dx = n.dir === 'left' ? -60 : n.dir === 'right' ? 60 : 0, dy = n.dir === 'up' ? -60 : n.dir === 'down' ? 60 : 0;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy, id: 1 }] });
      }
      if (n.type === 'hold') await page.waitForTimeout(n.dur * 1000);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      sent++;
    }
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/43-${label}-gameplay.png` });
    const c = await page.evaluate(() => window.__fsGame.session.counts);
    const hits = c.perfectPlus + c.perfect + c.great;
    log(`${label}: real touch events register on the right lanes`, hits > 0, `sent ${sent}, hits ${hits}, misses ${c.miss} (CDP round-trips make timing approximate)`);
    if (label === 'iphone-portrait') {
      await page.goto(URL);
      await page.waitForSelector('.press-start');
      await page.touchscreen.tap(100, 200);
      await page.waitForSelector('.home');
      await page.tap('.tile:has-text("Tutorial")');
      await page.waitForFunction(() => window.__fsGame && window.__fsGame.session && window.__fsGame.songTime > -2, null, { timeout: 20000 });
      const tt = bot(page, { method: 'touch', maxSeconds: 120 });
      await page.waitForFunction(() => window.__fsGame && window.__fsGame.songTime > 50, null, { timeout: 90000 });
      await page.screenshot({ path: `${OUT}/44-${label}-tutorial-rail.png` });
      const tr2 = await tt;
      log(`${label}: tutorial via touch (incl. diagonal flicks, switch & rail slides): all clean`, tr2.counts.miss === 0 && tr2.counts.holdBreaks === 0, JSON.stringify(tr2.byType));
    }
    log(`${label}: no page errors`, errs.length === 0, errs.slice(0, 2).join(' | '));
    await ctx.close();
  }
} catch (e) {
  log('e2e script crashed', false, String(e.stack || e));
} finally {
  await browser.close();
  server.kill();
  writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
