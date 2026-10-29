'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const local = path.join(__dirname, '..', 'docs', 'engine.js');
const source = fs.readFileSync(fs.existsSync(local) ? local : path.join(__dirname, '..', 'outputs', 'mine-express', 'docs', 'engine.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));

function harness(options = {}) {
  const slug = options.slug || 'test-game';
  const key = 'offline.' + slug + '.v1';
  const entries = new Map(options.entries || []);
  if (options.raw !== undefined) entries.set(key, options.raw);
  else if (options.state) entries.set(key, JSON.stringify(options.state));
  const writes = [], instances = [], raf = [], listeners = new Map(), domListeners = new Map();
  let now = 1000;
  function node() {
    const handlers = new Map();
    return {
      textContent: '', dataset: {}, hidden: false, children: [], capture: new Set(),
      addEventListener(name, handler) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(handler); },
      emit(name, values = {}) { const event = { preventDefault() {}, ...values }; for (const handler of handlers.get(name) || []) handler(event); },
      focus() {}, getContext() { return { clearRect() {} }; },
      getBoundingClientRect() { return { left: 10, top: 20, width: 210, height: 300 }; },
      setPointerCapture(id) { this.capture.add(id); },
      releasePointerCapture(id) { this.capture.delete(id); this.emit('lostpointercapture', { pointerId: id }); }
    };
  }
  const elements = Object.fromEntries(['game', 'hint', 'hud', 'overlay', 'overlay-title', 'overlay-text', 'play', 'restart', 'record', 'pause', 'directions', 'dir-left', 'dir-up', 'dir-down', 'dir-right', 'action-row', 'action'].map(id => [id, node()]));
  elements.hud.children = Array.from({length: 3}, () => ({children: [node(), node()]}));
  const classes = new Set();
  const document = {
    hidden: false, body: { classList: { add(name) { classes.add(name); } } },
    getElementById(id) { assert(elements[id], 'Unexpected element: ' + id); return elements[id]; },
    addEventListener(name, callback) { domListeners.set(name, callback); }
  };
  const window = {
    APP: { slug, title: 'Test game', description: 'Test description', controls: options.controls, action: options.action, saveVersion: options.saveVersion },
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); },
    createGame(api) {
      const instance = {
        api, value: 0, elapsed: 0, resets: 0, restores: 0, nexts: 0, updates: [], pointers: [], keys: [], held: new Set(),
        reset() { this.resets++; this.value = 0; this.elapsed = 0; api.progress.resetMarks = (Number(api.progress.resetMarks) || 0) + 1; api.save(); },
        restore(saved) {
          this.restores++;
          if (saved.corrupt || saved.throws) {
            api.progress.poison = 'must not survive'; saved.value = -100; api.save();
            if (saved.throws) throw new Error('Bad save');
            return false;
          }
          this.value = saved.value; this.elapsed = saved.elapsed || 0; this.status = saved.status;
          api.progress.restored = true; api.save(); return true;
        },
        snapshot() { return { value: this.value, elapsed: this.elapsed, ...(this.status ? { status: this.status } : {}) }; },
        next() { this.nexts++; this.value += 100; this.elapsed = 0; api.progress.level = (api.progress.level || 0) + 1; api.save(); },
        update(dt) { this.elapsed += dt; this.updates.push(dt); },
        draw() {},
        pointer(...args) { this.pointers.push(args); },
        key(k, down) { this.keys.push([k, down]); if (down) this.held.add(k); else this.held.delete(k); }
      };
      instances.push(instance);
      return instance;
    }
  };
  const localStorage = {
    getItem(name) { if (options.storageBlocked) throw new Error('Storage denied'); return entries.get(name) || null; },
    setItem(name, value) { if (options.storageBlocked) throw new Error('Storage denied'); entries.set(name, value); writes.push([name, value]); }
  };
  vm.runInNewContext(source, { window, document, localStorage, location: { search: options.search || '' }, URLSearchParams, performance: { now: () => now }, requestAnimationFrame(callback) { raf.push(callback); } });
  return {
    window, document, elements, instances, entries, writes, key, classes,
    current: () => window.arcade.game,
    saved: () => JSON.parse(entries.get(key)),
    click(id) { elements[id].onclick(); },
    emit(name, values = {}) { for (const callback of listeners.get(name) || []) callback({ preventDefault() {}, ...values }); },
    visibility(hidden) { document.hidden = hidden; domListeners.get('visibilitychange')(); },
    pointer(type, id = 1, x = 90, y = 120) { elements.game.emit(type, { pointerId: id, clientX: x, clientY: y }); },
    step(ms) { now += ms; assert(raf.length, 'No animation frame scheduled'); raf.shift()(now); }
  };
}

test('home preview preserves saved game and progression byte for byte', () => {
  const raw = JSON.stringify({ progress: { coins: 55, resetMarks: 9 }, saved: { value: 47, elapsed: 3 }, best: 80 });
  const h = harness({ raw });
  assert.equal(h.elements.play.textContent, 'Reprendre ma partie');
  assert.equal(h.current().resets, 1);
  assert.equal(h.window.arcade.api.progress.resetMarks, 9);
  h.window.arcade.save(); h.emit('pagehide'); h.step(5000);
  assert.equal(h.entries.get(h.key), raw);
  assert.equal(h.writes.length, 0);
});
test('resume restores snapshot instead of resetting it and retains progression', () => {
  const h = harness({ state: { progress: { coins: 55, resetMarks: 9 }, saved: { value: 47, elapsed: 3 } } });
  h.click('play');
  assert.equal(h.current().value, 47); assert.equal(h.current().elapsed, 3);
  assert.equal(h.current().resets, 0); assert.equal(h.current().restores, 1);
  assert.equal(h.saved().progress.coins, 55); assert.equal(h.saved().progress.resetMarks, 9);
  assert.equal(h.elements.overlay.hidden, true);
});
test('pause freezes simulation and resume discards elapsed wall clock time', () => {
  const h = harness(); h.click('play'); h.step(40);
  const game = h.current(); assert.equal(game.elapsed, 0.04);
  h.click('pause'); const saved = clone(h.saved().saved); h.step(60000); h.step(1000);
  assert.equal(game.elapsed, 0.04); assert.deepEqual(h.saved().saved, saved);
  assert.equal(h.elements.overlay.dataset.mode, 'pause');
  h.click('play'); h.step(16);
  assert(Math.abs(game.elapsed - 0.056) < 0.000001);
});
test('pause releases every held key and the pointer capture before resuming', () => {
  const h = harness(); h.click('play'); const game = h.current();
  for (const k of ['ArrowRight', 'e', 'Enter']) h.emit('keydown', { key: k });
  h.pointer('pointerdown', 7); assert(h.elements.game.capture.has(7));
  h.click('pause');
  assert.equal(game.held.size, 0); assert.equal(h.elements.game.capture.size, 0);
  for (const k of ['ArrowRight', 'e', 'Enter']) assert(game.keys.some(([key, down]) => key === k && !down));
  assert(game.pointers.some(([type]) => type === 'cancel'));
  h.click('play'); const before = game.pointers.length; h.pointer('pointerdown', 8);
  assert.equal(game.pointers.length, before + 1);
  assert.deepEqual(Array.from(game.pointers.at(-1)), ['down', 160, 200]);
});
test('new game from pause resets the run while keeping permanent progression', () => {
  const h = harness({ state: { progress: { coins: 80 }, saved: { value: 42 } } });
  h.click('play'); const old = h.current(); h.click('pause'); h.click('restart');
  assert.notEqual(h.current(), old); assert.equal(h.current().value, 0); assert.equal(h.current().resets, 1);
  assert.equal(h.saved().progress.coins, 80); assert.equal(h.saved().saved.value, 0); assert.equal(h.elements.overlay.hidden, true);
});
test('loss clears the resumable run, stores record once, and offers a fresh replay', () => {
  const h = harness(); h.click('play'); const old = h.current(); old.value = 99;
  h.window.arcade.api.end('Lost', 'Try again', 120, false);
  assert.equal(h.saved().saved, null); assert.equal(h.saved().best, 120);
  assert.equal(h.elements.play.textContent, 'Rejouer');
  h.window.arcade.api.end('Duplicate', 'Ignored', 999, true);
  assert.equal(h.saved().best, 120); assert.equal(h.elements['overlay-title'].textContent, 'Lost');
  h.click('play'); assert.notEqual(h.current(), old); assert.equal(h.current().value, 0); assert.equal(h.saved().saved.value, 0);
});
test('victory continues using next and persists the resulting level and snapshot', () => {
  const h = harness(); h.click('play'); const game = h.current(); game.value = 12;
  h.window.arcade.api.end('Won', 'Next level', 150, true);
  assert.equal(h.elements.play.textContent, 'Continuer'); assert.equal(h.saved().saved, null);
  h.click('play');
  assert.equal(h.current(), game); assert.equal(game.nexts, 1); assert.equal(game.value, 112);
  assert.equal(h.saved().progress.level, 1); assert.equal(h.saved().saved.value, 112); assert.equal(h.elements.overlay.hidden, true);
});
test('a malformed JSON save does not prevent starting a fresh game', () => {
  const h = harness({ raw: '{bad json' }); assert.equal(h.elements.play.textContent, 'Jouer');
  h.click('play'); assert.equal(h.current().resets, 1); assert.equal(h.saved().saved.value, 0);
});
test('array progression is replaced by a plain object instead of losing named fields', () => {
  const h = harness({ state: { progress: [], saved: { value: 3 } } }); h.click('play');
  assert.equal(Array.isArray(h.saved().progress), false); assert.equal(h.saved().progress.restored, true);
});
for (const rejection of ['corrupt', 'throws']) test('restore ' + rejection + ' rolls back partial progression mutations', () => {
  const h = harness({ state: { progress: { coins: 55 }, saved: { value: 40, [rejection]: true } } });
  h.click('play');
  assert.equal(h.current().resets, 1); assert.equal(h.current().value, 0);
  assert.equal(h.saved().progress.coins, 55); assert.equal(h.saved().progress.poison, undefined);
});
test('unavailable local storage still permits playing', () => {
  const h = harness({ storageBlocked: true }); h.click('play'); h.step(16);
  assert.equal(h.elements.overlay.hidden, true); assert(h.current().updates.length > 0);
  assert.equal(h.elements.hint.textContent, 'Sauvegarde indisponible sur cet appareil.');
});
test('saving one application never changes another application storage key', () => {
  const other = 'offline.other-game.v1'; const raw = '{"saved":{"value":77}}';
  const h = harness({ slug: 'one-game', entries: [[other, raw]] }); h.click('play'); h.window.arcade.save();
  assert.equal(h.entries.get(other), raw); assert(h.writes.every(([key]) => key === h.key));
});
test('lost pointer capture cancels the gesture and accepts the next pointer', () => {
  const h = harness(); h.click('play'); const game = h.current();
  h.pointer('pointerdown', 4); h.elements.game.emit('lostpointercapture', {pointerId: 4});
  assert.equal(game.pointers.at(-1)[0], 'cancel');
  h.pointer('pointerdown', 5); assert.equal(game.pointers.at(-1)[0], 'down');
});
test('periodic saving captures the current active simulation', () => {
  const h = harness(); h.click('play'); h.current().value = 25;
  const initial = h.writes.length; for (let i = 0; i < 55; i++) h.step(40);
  assert(h.writes.length > initial); assert.equal(h.saved().saved.value, 25); assert(h.saved().saved.elapsed >= 2);
});
test('native query parameter activates the native layout', () => {
  assert(harness({search: '?native=1'}).classes.has('native'));
  assert.equal(harness().classes.has('native'), false);
});
test('Android back pauses an active game and allows exiting an existing menu', () => {
  const h = harness(); assert.equal(h.window.__handleBack(), false); h.click('play');
  assert.equal(h.window.__handleBack(), true); assert.equal(h.elements.overlay.dataset.mode, 'pause');
  assert.equal(h.window.__handleBack(), false); h.click('play'); h.window.arcade.api.end('Lost', 'End', 0, false);
  assert.equal(h.window.__handleBack(), false);
});
test('visibility and pagehide both save and pause the active game', () => {
  const h = harness(); h.click('play'); h.current().value = 88; h.visibility(true);
  assert.equal(h.elements.overlay.dataset.mode, 'pause'); assert.equal(h.saved().saved.value, 88);
  h.click('play'); h.current().value = 89; h.emit('pagehide'); assert.equal(h.saved().saved.value, 89);
  assert.equal(h.elements.overlay.dataset.mode, 'pause');
});
test('terminal snapshot left by interrupted end callback starts a playable run', () => {
  const h = harness({state: {progress: {coins: 22}, saved: {value: 40, status: 'won'}}}); h.click('play');
  assert.equal(h.current().value, 0); assert.equal(h.current().resets, 1); assert.equal(h.saved().progress.coins, 22);
});

test('direction buttons produce exactly one step and release the key', () => {
 const h=harness({controls:'directional'});h.click('dir-left');assert.equal(h.current().keys.length,0);
 h.click('play');const game=h.current();
 for(const [id,key]of [['dir-left','ArrowLeft'],['dir-up','ArrowUp'],['dir-down','ArrowDown'],['dir-right','ArrowRight']]){const n=game.keys.length;h.click(id);assert.deepEqual(game.keys.slice(n),[[key,true],[key,false]]);}
 assert.equal(game.held.size,0);assert.equal(h.elements['dir-left'].disabled,false);
});
test('direction buttons cannot move during pause, menus or terminal results', () => {
 const h=harness({controls:'directional'});h.click('play');h.click('pause');const game=h.current(),n=game.keys.length;
 assert.equal(h.elements['dir-up'].disabled,true);h.click('dir-up');assert.equal(game.keys.length,n);
 h.click('play');assert.equal(h.elements['dir-up'].disabled,false);h.window.arcade.api.end('Lost','',0,false);const ended=game.keys.length;h.click('dir-up');assert.equal(game.keys.length,ended);
});
test('action button can pulse a dash while the joystick pointer stays captured', () => {
 const h=harness({action:{key:' ',label:'Esquive'}});h.click('play');h.pointer('pointerdown',7);const game=h.current(),n=game.keys.length;
 h.click('action');assert.deepEqual(game.keys.slice(n),[[' ',true],[' ',false]]);assert(h.elements.game.capture.has(7));assert.equal(game.held.size,0);
 h.click('pause');assert.equal(h.elements.action.disabled,true);const paused=game.keys.length;h.click('action');assert.equal(game.keys.length,paused);
});


test('new rules discard only an incompatible active run and preserve permanent progression', () => {
 const h=harness({saveVersion:2,state:{progress:{coins:55,level:4},saved:{version:1,value:99},best:80}});
 assert.equal(h.elements.play.textContent,'Jouer');assert.equal(h.writes.length,0);assert.match(h.elements['overlay-text'].textContent,/progression est conservée/);
 h.click('play');assert.equal(h.current().value,0);assert.equal(h.saved().progress.coins,55);assert.equal(h.saved().progress.level,4);assert.equal(h.saved().best,80);
});
