'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createGame, initialState, validState, stats, xpNeed, ARENA, DURATION,
  CAPS, MAX_ENEMIES, MAX_BULLETS, MAX_GEMS
} = require('../docs/game.js');

function setup(random = () => .314159) {
  const ends = [], progress = {}, game = createGame({
    progress, random, end: (...args) => ends.push(args), hud() {}, toast() {}, save() {}
  });
  return {game, ends, progress};
}
function press(game, key) { game.key(key, true); game.key(key, false); }
function drone(id, x, y, extra = {}) {
  return {id, x, y, kind: 0, hp: 2, maxHp: 2, speed: 10, radius: 12, ...extra};
}
function choiceScore(state, id) {
  if (id === 'repair') return state.hero.hp <= 2 ? 100 : 0;
  if (id === 'armor') return state.hero.hp < stats(state).maxHp ? 95 : 65;
  return {split: 90, overclock: 85, cannon: 80, pierce: 75, magnet: 70, servos: 40}[id] || 0;
}
// This bot only uses public touch/key input. It never writes to a live state.
function playBot(game, state) {
  if (state.mode === 'upgrade') {
    let index = 0;
    for (let n = 1; n < state.choices.length; n++) {
      if (choiceScore(state, state.choices[n]) > choiceScore(state, state.choices[index])) index = n;
    }
    press(game, String(index + 1));
    return;
  }
  const phase = state.time * .8;
  const target = {x: 210 + 125 * Math.cos(phase), y: 339 + 145 * Math.sin(phase)};
  let dx = target.x - state.hero.x, dy = target.y - state.hero.y;
  const routeLength = Math.hypot(dx, dy) || 1;
  dx /= routeLength; dy /= routeLength;
  for (const enemy of state.enemies) {
    const ex = state.hero.x - enemy.x, ey = state.hero.y - enemy.y, distance = Math.hypot(ex, ey) || 1;
    if (distance < 65) {
      const weight = (65 - distance) / 65 * 2.4;
      dx += ex / distance * weight; dy += ey / distance * weight;
    }
  }
  const length = Math.hypot(dx, dy) || 1;
  game.pointer('down', 210, 339);
  game.pointer('move', 210 + dx / length * 45, 339 + dy / length * 45);
}

test('initial seeds and upgrade caps produce valid, bounded states', () => {
  for (const seed of [0, 1, 123456789, 4294967295]) {
    const state = initialState(seed);
    assert.equal(validState(state), true);
    assert.equal(state.time, 0);
    assert.equal(state.hero.hp, stats(state).maxHp);
    assert.equal(state.mode, 'arena');
    assert.equal(state.rng, seed);
    state.upgrades = {...CAPS};
    assert.equal(validState(state), true);
    assert.ok(stats(state).maxHp > 6);
    assert.ok(stats(state).speed > 150);
    assert.ok(stats(state).interval < stats(initialState(seed)).interval);
  }
  assert.ok(xpNeed(10) > xpNeed(1));
});

test('fragments trigger a real upgrade and its choice freezes combat time', () => {
  const {game} = setup(), state = initialState(42);
  state.xp = xpNeed(state.level) - 2;
  state.gems = [{x: state.hero.x, y: state.hero.y, value: 2}];
  assert.equal(game.restore(state), true);
  game.update(1 / 60);
  const offered = game.snapshot();
  assert.equal(offered.mode, 'upgrade');
  assert.equal(offered.level, 2);
  assert.equal(offered.xp, 0);
  assert.equal(offered.gems.length, 0);
  assert.equal(offered.choices.length, 3);
  assert.equal(new Set(offered.choices).size, 3);
  for (let n = 0; n < 20; n++) game.update(.1);
  assert.deepEqual(game.snapshot(), offered, 'time, enemies and projectiles must all pause');
  const id = offered.choices[1];
  game.pointer('down', 100, 225 + 85 + 30);
  const chosen = game.snapshot();
  assert.equal(chosen.mode, 'arena');
  assert.deepEqual(chosen.choices, []);
  assert.equal(chosen.upgrades[id], offered.upgrades[id] + 1);
  assert.ok(chosen.hero.invuln > 0, 'a choice grants a safe moment to move again');
  assert.equal(validState(chosen), true);
});

test('every upgrade has an effect and fully capped offers remain playable', () => {
  for (const id of [...Object.keys(CAPS), 'repair']) {
    const {game} = setup(), state = initialState(7);
    state.mode = 'upgrade'; state.choices = [id]; state.hero.hp = 1;
    assert.equal(game.restore(state), true);
    const before = stats(state);
    press(game, '1');
    const after = game.snapshot();
    assert.equal(after.mode, 'arena'); assert.equal(validState(after), true);
    assert.ok(after.hero.hp > 1, 'upgrade selection repairs the robot');
    if (id !== 'repair') assert.equal(after.upgrades[id], 1);
    if (id === 'overclock') assert.ok(stats(after).interval < before.interval);
    if (id === 'cannon') assert.ok(stats(after).damage > before.damage);
    if (id === 'servos') assert.ok(stats(after).speed > before.speed);
    if (id === 'magnet') assert.ok(stats(after).magnet > before.magnet);
    if (id === 'armor') assert.ok(stats(after).maxHp > before.maxHp);
    if (id === 'split') assert.ok(stats(after).shots > before.shots);
    if (id === 'pierce') assert.ok(stats(after).pierce > before.pierce);
  }
  const capped = setup(), state = initialState(19);
  state.upgrades = {...CAPS}; state.hero.hp = stats(state).maxHp; state.xp = xpNeed(state.level);
  assert.equal(capped.game.restore(state), true);
  capped.game.update(1 / 60);
  assert.equal(validState(capped.game.snapshot()), true);
  assert.deepEqual(capped.game.snapshot().choices, ['repair']);
  press(capped.game, 'Enter');
  assert.equal(capped.game.snapshot().mode, 'arena');
  assert.deepEqual(capped.game.snapshot().upgrades, CAPS);
});

test('auto-fire hits drones and their fragments can actually be collected', () => {
  const {game} = setup(), state = initialState(5);
  state.spawn = 2; state.fire = 0; state.nextId = 2;
  state.enemies = [drone(1, state.hero.x + 40, state.hero.y)];
  assert.equal(game.restore(state), true);
  for (let n = 0; n < 6; n++) game.update(.1);
  const result = game.snapshot();
  assert.equal(result.kills, 1); assert.equal(result.enemies.length, 0);
  assert.equal(result.gems.length, 0); assert.equal(result.xp, 2);
  assert.equal(result.hero.hp, 6);
});

test('saved RNG resumes deterministically and all saved objects are copied', () => {
  const a = setup(), b = setup(() => .99); a.game.reset();
  for (let n = 0; n < 30; n++) { playBot(a.game, a.game.snapshot()); a.game.update(.1); }
  a.game.pointer('cancel', 0, 0);
  const saved = JSON.parse(JSON.stringify(a.game.snapshot()));
  assert.equal(b.game.restore(saved), true);
  assert.deepEqual(b.game.snapshot(), saved);
  saved.hero.hp = 1; saved.upgrades.armor = 3; saved.enemies.length = 0;
  assert.notEqual(b.game.snapshot().hero.hp, 1);
  assert.notEqual(b.game.snapshot().upgrades.armor, 3);
  for (let n = 0; n < 300; n++) {
    const current = a.game.snapshot();
    if (current.mode === 'upgrade') { press(a.game, '1'); press(b.game, '1'); }
    a.game.update(.05); b.game.update(.05);
    assert.deepEqual(b.game.snapshot(), a.game.snapshot(), 'the same saved RNG must reproduce future spawns and upgrades');
  }
});

test('restore clears the active joystick and keyboard, and invalid saves leave state intact', () => {
  const a = setup(), b = setup(); a.game.reset();
  a.game.pointer('down', 210, 339); a.game.pointer('move', 255, 339); a.game.update(.1);
  const saved = a.game.snapshot();
  assert.ok(saved.hero.x > 210);
  assert.equal(b.game.restore(saved), true); b.game.update(.1);
  assert.equal(b.game.snapshot().hero.x, saved.hero.x, 'restored touch input is neutral');
  b.game.key('ArrowRight', true);
  assert.equal(b.game.restore(saved), true); b.game.update(.1);
  assert.equal(b.game.snapshot().hero.x, saved.hero.x, 'restored keyboard input is neutral');
  const good = b.game.snapshot();
  for (const corrupt of [
    null, {}, {...good, version: 99}, {...good, rng: -1}, {...good, time: Infinity},
    {...good, hero: {...good.hero, hp: -1}}, {...good, hero: {...good.hero, x: -1}},
    {...good, status: 'won'}, {...good, mode: 'upgrade', choices: []},
    {...good, mode: 'upgrade', choices: ['repair', 'repair']},
    {...good, upgrades: {...good.upgrades, cannon: CAPS.cannon + 1}}
  ]) {
    assert.equal(b.game.restore(corrupt), false); assert.deepEqual(b.game.snapshot(), good);
  }
});

test('entity caps hold when spawns and shots are already saturated', () => {
  const {game} = setup(), state = initialState(3);
  state.spawn = 0; state.fire = 0; state.nextId = MAX_ENEMIES + 1;
  state.enemies = Array.from({length: MAX_ENEMIES}, (_, n) => drone(n + 1, ARENA.left, ARENA.top));
  state.bullets = Array.from({length: MAX_BULLETS}, () => ({x: 200, y: 500, vx: 340, vy: 0, damage: 1, pierce: 0, life: 2, hit: []}));
  state.gems = Array.from({length: MAX_GEMS}, () => ({x: ARENA.left, y: ARENA.top, value: 1}));
  assert.equal(game.restore(state), true); game.update(.1);
  const result = game.snapshot();
  assert.equal(result.enemies.length, MAX_ENEMIES);
  assert.equal(result.bullets.length, MAX_BULLETS);
  assert.equal(result.gems.length, MAX_GEMS);
  assert.equal(validState(result), true);
  const merge = initialState(4);
  merge.spawn = 2; merge.fire = 0; merge.nextId = 2;
  merge.enemies = [drone(1, merge.hero.x + 40, merge.hero.y)];
  merge.gems = Array.from({length: MAX_GEMS}, () => ({x: ARENA.left, y: ARENA.top, value: 1}));
  assert.equal(game.restore(merge), true);
  for (let n = 0; n < 4; n++) game.update(.1);
  const merged = game.snapshot();
  assert.equal(merged.kills, 1); assert.equal(merged.gems.length, MAX_GEMS);
  assert.equal(merged.gems.reduce((sum, gem) => sum + gem.value, 0), MAX_GEMS + 2, 'a saturated fragment pool merges values');
});

test('victory and collision death end once; resuming a terminal save stays silent', () => {
  const winning = setup(), nearWin = initialState(1);
  nearWin.time = DURATION - 1 / 120; nearWin.spawn = 2; nearWin.fire = 2;
  assert.equal(winning.game.restore(nearWin), true); winning.game.update(1 / 60);
  assert.equal(winning.game.snapshot().status, 'won');
  assert.equal(winning.game.snapshot().time, DURATION);
  assert.equal(winning.ends.length, 1); assert.equal(winning.ends[0][3], true);
  winning.game.update(.1); press(winning.game, 'd'); assert.equal(winning.ends.length, 1);
  assert.equal(winning.progress.robot.runs, 1); assert.equal(winning.progress.robot.wins, 1);
  const resumed = setup(); assert.equal(resumed.game.restore(winning.game.snapshot()), true);
  resumed.game.update(.1); assert.equal(resumed.ends.length, 0);
  const losing = setup(), collision = initialState(2);
  collision.hero.hp = 1; collision.fire = 2; collision.spawn = 2; collision.nextId = 2;
  collision.enemies = [drone(1, collision.hero.x, collision.hero.y)];
  assert.equal(losing.game.restore(collision), true); losing.game.update(1 / 60);
  assert.equal(losing.game.snapshot().status, 'lost'); assert.equal(losing.game.snapshot().hero.hp, 0);
  assert.equal(losing.ends.length, 1); assert.equal(losing.ends[0][3], false);
  losing.game.update(.1); assert.equal(losing.ends.length, 1);
  assert.equal(losing.progress.robot.runs, 1); assert.equal(losing.progress.robot.wins, 0);
});

test('legal movement and upgrade choices can survive 90 seconds across twelve seeds', () => {
  const seeds = [0, .01, .07, .13, .2, .314159, .4, .5, .67, .75, .91, .999999];
  for (const seed of seeds) {
    const {game, ends, progress} = setup(() => seed); game.reset();
    for (let step = 0; step < 1600 && game.snapshot().status === 'playing'; step++) {
      playBot(game, game.snapshot()); game.update(.1);
      const current = game.snapshot();
      assert.ok(current.enemies.length <= MAX_ENEMIES);
      assert.ok(current.bullets.length <= MAX_BULLETS);
      assert.ok(current.gems.length <= MAX_GEMS);
      if (step % 30 === 0) assert.equal(validState(current), true, 'live state stays serializable');
    }
    const result = game.snapshot();
    assert.equal(result.status, 'won', '90 seconds must be attainable from seed ' + seed);
    assert.equal(result.time, DURATION); assert.ok(result.hero.hp > 0);
    assert.ok(result.level >= 2, 'the route must collect fragments and choose upgrades');
    assert.ok(result.kills > 30, 'automatic combat must work during survival');
    assert.equal(ends.length, 1); assert.equal(progress.robot.wins, 1);
    assert.equal(validState(result), true);
  }
});
