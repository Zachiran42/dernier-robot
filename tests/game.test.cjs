'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createGame, initialState, validState, stats, xpNeed, ARENA, ROOM_COUNT, ROOM_DURATION,
  CAPS, MAX_ENEMIES, MAX_BULLETS, MAX_GEMS, MAX_PICKUPS, MAX_ENEMY_BULLETS, PICKUP_INFO
} = require('../docs/game.js');
function setup(random = () => .314159, progress = {}) {
  const ends = [], game = createGame({progress, random, end: (...args) => ends.push(args), hud() {}, toast() {}, save() {}});
  return {game, ends, progress};
}
function press(game, key) { game.key(key, true); game.key(key, false); }
function drone(id, x, y, extra = {}) {
  return {id, x, y, kind: 0, hp: 10, maxHp: 10, speed: 10, radius: 12, slow: 0, cooldown: 3, windup: 0, chargeTime: 0, aimX: 0, aimY: 0, pattern: 0, ...extra};
}
function fixture(overrides = {}) { return {...initialState(42), spawn: 3, fire: 3, ...overrides}; }
function advance(game, seconds) { for (let left = seconds; left > 1e-8; left -= .05) game.update(Math.min(.05, left)); }
function install(game, state) { assert.equal(validState(state), true, 'test fixture must respect the public save format'); assert.equal(game.restore(state), true); }
function choiceScore(state, id) {
  if (id === 'repair') return state.hero.hp <= 3 ? 125 : state.hero.hp <= 5 ? 90 : -20;
  if (id === 'armor') return state.hero.hp <= 4 ? 120 : 64;
  return {split: 105, shock: 100, overclock: 95, cannon: 93, pierce: 78, orbit: 74, magnet: 70, frost: 65, servos: 62}[id] || 0;
}
// Balance bot: normal reset, public controls only, no restore or state injection.
function playBot(game, state, profile = 'offense') {
  if (state.mode === 'upgrade') {
    const rate = id => profile === 'hybrid' ? id === 'repair' ? (state.hero.hp <= 3 ? 125 : 0) : id === 'armor' ? (state.hero.hp < 5 ? 120 : 70) : ({split: 100, shock: 88, overclock: 85, cannon: 86, servos: 84, frost: 82, orbit: 75, magnet: 68, pierce: 65}[id] || 0) : choiceScore(state, id);
    let choice = 0;
    for (let n = 1; n < state.choices.length; n++) if (rate(state.choices[n]) > rate(state.choices[choice])) choice = n;
    press(game, String(choice + 1)); return;
  }
  if (state.mode === 'route') { press(game, state.hero.hp <= Math.max(3, stats(state).maxHp * .48) ? '2' : profile === 'hybrid' && state.room % 2 ? '3' : '1'); return; }
  const hero = state.hero, phase = state.time * .79;
  let target = {x: 210 + 125 * Math.cos(phase), y: 339 + 145 * Math.sin(phase)};
  const pickup = state.pickups.filter(p => p.kind === 'repair' && hero.hp < stats(state).maxHp || p.kind === 'shield' && hero.shield < 4 || p.kind === 'magnet')
    .sort((a, b) => Math.hypot(a.x - hero.x, a.y - hero.y) - Math.hypot(b.x - hero.x, b.y - hero.y))[0];
  if (pickup && Math.hypot(pickup.x - hero.x, pickup.y - hero.y) < 125) target = pickup;
  let dx = target.x - hero.x, dy = target.y - hero.y, length = Math.hypot(dx, dy) || 1, danger = 0;
  dx /= length; dy /= length;
  for (const enemy of state.enemies) {
    const ex = hero.x - enemy.x, ey = hero.y - enemy.y, distance = Math.hypot(ex, ey) || 1;
    if (distance < 70 + enemy.radius) { const weight = (70 + enemy.radius - distance) / (70 + enemy.radius) * 3; dx += ex / distance * weight; dy += ey / distance * weight; }
    if (distance < enemy.radius + 30) danger++;
  }
  for (const bullet of state.enemyBullets) {
    const ex = hero.x - (bullet.x + bullet.vx * .18), ey = hero.y - (bullet.y + bullet.vy * .18), distance = Math.hypot(ex, ey) || 1;
    if (distance < 45) { const weight = (45 - distance) / 45 * 2.7; dx += ex / distance * weight; dy += ey / distance * weight; if (distance < 25) danger++; }
  }
  if (hero.x < 55) dx += (55 - hero.x) / 30;
  if (hero.x > 365) dx -= (hero.x - 365) / 30;
  if (hero.y < 165) dy += (165 - hero.y) / 30;
  if (hero.y > 513) dy -= (hero.y - 513) / 30;
  length = Math.hypot(dx, dy) || 1;
  game.pointer('down', 210, 339); game.pointer('move', 210 + dx / length * 45, 339 + dy / length * 45);
  if (danger && hero.dashCooldown <= 0) press(game, ' ');
}

test('v2 starts valid with five sectors, ten power augments, and archived old wins', () => {
  assert.equal(ROOM_COUNT, 5); assert.ok(ROOM_DURATION >= 20); assert.equal(Object.keys(CAPS).length, 10);
  for (const seed of [0, 1, 123456789, 4294967295]) {
    const state = initialState(seed); assert.equal(validState(state), true); assert.equal(state.version, 2); assert.equal(state.room, 1); assert.equal(state.hero.hp, stats(state).maxHp);
    state.upgrades = {...CAPS}; assert.equal(validState(state), true); assert.ok(stats(state).speed > stats(initialState(seed)).speed);
  }
  const progress = {robot: {rules: 1, wins: 4, legacyWins: 2}}, {game} = setup(() => .2, progress); game.reset();
  assert.equal(progress.robot.wins, 0); assert.equal(progress.robot.legacyWins, 6); assert.equal(progress.robot.rules, 2);
  assert.equal(game.restore({...initialState(3), version: 1}), false);
  assert.ok(xpNeed(10) > xpNeed(1));
});

test('real gems trigger an augment offer, freezing combat and resuming after a card choice', () => {
  const {game} = setup(), state = fixture(); state.xp = xpNeed(1) - 2; state.gems = [{x: state.hero.x, y: state.hero.y, value: 2}];
  install(game, state); game.update(1 / 60); const offered = game.snapshot();
  assert.equal(offered.mode, 'upgrade'); assert.equal(offered.level, 2); assert.equal(offered.xp, 0); assert.equal(offered.gems.length, 0);
  assert.equal(offered.choices.length, 3); assert.equal(new Set(offered.choices).size, 3); advance(game, 1); assert.deepEqual(game.snapshot(), offered);
  const id = offered.choices[1]; game.pointer('down', 100, 340); const chosen = game.snapshot();
  assert.equal(chosen.mode, 'arena'); assert.equal(chosen.upgrades[id], 1); assert.deepEqual(chosen.choices, []); assert.ok(chosen.hero.invuln > 0); assert.equal(validState(chosen), true);
});

test('all ten augments and repair have distinct effects; capped offers remain usable', () => {
  for (const id of [...Object.keys(CAPS), 'repair']) {
    const {game} = setup(), state = fixture({mode: 'upgrade', choices: [id]}); state.hero.hp = 1; install(game, state); const before = stats(state); press(game, '1'); const after = game.snapshot();
    assert.equal(after.mode, 'arena'); assert.equal(validState(after), true);
    if (id !== 'repair') assert.equal(after.upgrades[id], 1);
    if (id === 'repair') assert.equal(after.hero.hp, 6);
    else if (id === 'armor') { assert.equal(after.hero.hp, 3); assert.equal(stats(after).maxHp, before.maxHp + 2); }
    else assert.equal(after.hero.hp, 1, 'power upgrades do not give free healing');
    if (id === 'overclock') assert.ok(stats(after).interval < before.interval);
    if (id === 'cannon') assert.equal(stats(after).damage, before.damage + 1);
    if (id === 'servos') { assert.ok(stats(after).speed > before.speed); assert.ok(stats(after).dashCooldown < before.dashCooldown); }
    if (id === 'magnet') assert.ok(stats(after).magnet > before.magnet);
    if (id === 'split') assert.equal(stats(after).shots, before.shots + 1);
    if (id === 'pierce') assert.equal(stats(after).pierce, before.pierce + 1);
  }
  const {game} = setup(), state = fixture(); state.upgrades = {...CAPS}; state.hero.hp = stats(state).maxHp; state.xp = xpNeed(1); install(game, state); game.update(1 / 60);
  assert.deepEqual(game.snapshot().choices, ['repair']); press(game, 'Enter'); assert.equal(game.snapshot().mode, 'arena'); assert.deepEqual(game.snapshot().upgrades, CAPS);
});

test('chain lightning, frost, orbit, and piercing change actual combat', () => {
  function combat(upgrades = {}) { const h = setup(), state = fixture({fire: 0, nextId: 3}); Object.assign(state.upgrades, upgrades); state.enemies = [drone(1, state.hero.x + 40, state.hero.y), drone(2, state.hero.x + 65, state.hero.y + 20)]; install(h.game, state); return h; }
  const ordinary = combat(), arc = combat({shock: 1}), cold = combat({frost: 1}); advance(ordinary.game, .2); advance(arc.game, .2); advance(cold.game, .2);
  assert.ok(arc.game.snapshot().enemies.find(e => e.id === 2).hp < ordinary.game.snapshot().enemies.find(e => e.id === 2).hp);
  assert.ok(cold.game.snapshot().enemies.find(e => e.id === 1).slow > 0);
  assert.ok(cold.game.snapshot().enemies.find(e => e.id === 1).x > ordinary.game.snapshot().enemies.find(e => e.id === 1).x, 'slow reduces real pursuit speed');
  const orbit = setup(), state = fixture({orbitTimer: 0, nextId: 2}); state.upgrades.orbit = 1; state.enemies = [drone(1, state.hero.x + 35, state.hero.y)]; install(orbit.game, state); orbit.game.update(1 / 60); assert.equal(orbit.game.snapshot().enemies[0].hp, 8);
  const piercing = setup(), line = fixture({fire: 0, nextId: 3}); line.upgrades.pierce = 1; line.enemies = [drone(1, line.hero.x + 40, line.hero.y), drone(2, line.hero.x + 70, line.hero.y)]; install(piercing.game, line); advance(piercing.game, .25); assert.deepEqual(piercing.game.snapshot().enemies.map(e => e.hp), [8, 8]);
});

test('all five dropped bonuses apply their advertised effects', () => {
  assert.deepEqual(Object.keys(PICKUP_INFO).sort(), ['bomb', 'haste', 'magnet', 'repair', 'shield']);
  for (const kind of Object.keys(PICKUP_INFO)) {
    const {game} = setup(), state = fixture(); state.hero.hp = 3; state.pickups = [{kind, x: state.hero.x, y: state.hero.y, ttl: 22}];
    if (kind === 'bomb') { state.room = 3; state.bossSpawned = true; state.nextId = 3; state.enemies = [drone(1, 100, 200, {hp: 3, maxHp: 3}), drone(2, 320, 200, {kind: 5, hp: 100, maxHp: 100, radius: 25})]; }
    const original = stats(state); install(game, state); game.update(1 / 60); const result = game.snapshot();
    assert.equal(result.pickupsCollected, 1); assert.equal(result.pickups.length, 0);
    if (kind === 'repair') assert.equal(result.hero.hp, 5);
    if (kind === 'shield') assert.equal(result.hero.shield, 2);
    if (kind === 'magnet') { assert.equal(result.hero.magnetTime, 10); assert.ok(stats(result).magnet > original.magnet); }
    if (kind === 'haste') { assert.equal(result.hero.hasteTime, 10); assert.ok(stats(result).interval < original.interval); }
    if (kind === 'bomb') { assert.equal(result.kills, 1); assert.equal(result.enemies[0].kind, 5); assert.equal(result.enemies[0].hp, 80); }
    assert.equal(validState(result), true);
  }
  const {game} = setup(), protectedState = fixture({nextId: 2}); protectedState.hero.shield = 2; protectedState.enemies = [drone(1, protectedState.hero.x, protectedState.hero.y)]; install(game, protectedState); game.update(1 / 60);
  assert.equal(game.snapshot().hero.hp, protectedState.hero.hp); assert.equal(game.snapshot().hero.shield, 1);
});

test('dash moves faster, blocks impacts, observes cooldown, and accepts keyboard or touch', () => {
  const {game} = setup(), state = fixture({nextId: 2}); state.enemies = [drone(1, state.hero.x, state.hero.y)]; install(game, state); game.key('ArrowRight', true); press(game, ' '); const dashed = game.snapshot();
  assert.ok(dashed.hero.dashTime > 0 && dashed.hero.dashCooldown > 0); press(game, ' '); assert.deepEqual(game.snapshot(), dashed, 'cooldown prevents a second dash');
  game.update(1 / 60); const moved = game.snapshot(); assert.ok(moved.hero.x - state.hero.x > stats(state).speed / 60); assert.equal(moved.hero.hp, state.hero.hp);
  game.key('ArrowRight', false); advance(game, stats(state).dashCooldown + .1); assert.equal(game.snapshot().hero.dashCooldown, 0); game.pointer('down', 354, 570); assert.ok(game.snapshot().hero.dashTime > 0);
});

test('each inter-sector route exchanges a real benefit for a different next-sector risk', () => {
  for (let choice = 0; choice < 3; choice++) {
    const {game} = setup(), state = fixture({mode: 'route', time: ROOM_DURATION, roomTime: ROOM_DURATION}); state.hero.hp = 2; install(game, state); advance(game, .5); assert.deepEqual(game.snapshot(), state, 'route decisions freeze time');
    press(game, String(choice + 1));
    if (choice === 0) { const reward = game.snapshot(); assert.equal(reward.mode, 'upgrade'); assert.equal(reward.pendingRoute, 'elite'); assert.equal(reward.rewardUpgrade, true); assert.equal(reward.level, state.level); const id = reward.choices[0]; press(game, '1'); const result = game.snapshot(); assert.equal(result.room, 2); assert.equal(result.roomType, 'elite'); assert.equal(result.upgrades[id], 1); assert.equal(result.level, state.level); }
    if (choice === 1) { const result = game.snapshot(); assert.equal(result.room, 2); assert.equal(result.roomType, 'normal'); assert.equal(result.hero.hp, 5); assert.deepEqual(result.upgrades, state.upgrades); }
    if (choice === 2) { const result = game.snapshot(); assert.equal(result.room, 2); assert.equal(result.roomType, 'cache'); assert.equal(result.hero.hp, 2); assert.equal(result.hero.shield, 2); assert.equal(result.hero.magnetTime, 12); }
    assert.equal(game.snapshot().roomTime, 0); assert.equal(validState(game.snapshot()), true);
  }
});

test('a sector must be cleared; bosses and telegraphed attackers are real threats', () => {
  const held = setup(), state = fixture({time: ROOM_DURATION, roomTime: ROOM_DURATION, nextId: 2}); state.enemies = [drone(1, 80, 180)]; install(held.game, state); held.game.update(1 / 60); assert.equal(held.game.snapshot().mode, 'arena');
  for (const room of [3, 5]) {
    const {game} = setup(), state = fixture({room, time: room * ROOM_DURATION, roomTime: ROOM_DURATION}); install(game, state); game.update(1 / 60); const result = game.snapshot();
    assert.equal(result.status, 'playing'); assert.equal(result.mode, 'arena'); assert.equal(result.bossSpawned, true); assert.ok(result.enemies.some(e => e.kind === 5));
  }
  const shooting = setup(), shooterState = fixture({room: 3, bossSpawned: true, nextId: 2}); shooterState.enemies = [drone(1, 80, 180, {kind: 3, cooldown: 0})]; install(shooting.game, shooterState); shooting.game.update(1 / 60); assert.ok(shooting.game.snapshot().enemies[0].windup > 0); assert.equal(shooting.game.snapshot().enemyBullets.length, 0); advance(shooting.game, .6); assert.ok(shooting.game.snapshot().enemyBullets.length > 0);
  const charging = setup(), chargeState = fixture({room: 3, bossSpawned: true, nextId: 2}); chargeState.enemies = [drone(1, 80, 180, {kind: 4, cooldown: 0})]; install(charging.game, chargeState); charging.game.update(1 / 60); assert.ok(charging.game.snapshot().enemies[0].windup > 0); advance(charging.game, .7); assert.ok(charging.game.snapshot().enemies[0].chargeTime > 0);
});

test('all entity pools stay capped; saturated gems merge and pickup overflow is bounded', () => {
  const {game} = setup(), state = fixture({spawn: 0, fire: 0, nextId: MAX_ENEMIES + 1});
  state.enemies = Array.from({length: MAX_ENEMIES}, (_, n) => drone(n + 1, 40, 150));
  state.bullets = Array.from({length: MAX_BULLETS}, () => ({x: 200, y: 500, vx: 100, vy: 0, damage: 1, pierce: 0, life: 2, hit: []}));
  state.enemyBullets = Array.from({length: MAX_ENEMY_BULLETS}, () => ({x: 24, y: 134, vx: 0, vy: 0, life: 4, damage: 1}));
  state.gems = Array.from({length: MAX_GEMS}, () => ({x: 24, y: 134, value: 1})); state.pickups = Array.from({length: MAX_PICKUPS}, () => ({kind: 'repair', x: 35, y: 145, ttl: 22}));
  install(game, state); game.update(.1); const result = game.snapshot();
  for (const [key, max] of [['enemies', MAX_ENEMIES], ['bullets', MAX_BULLETS], ['enemyBullets', MAX_ENEMY_BULLETS], ['gems', MAX_GEMS], ['pickups', MAX_PICKUPS]]) assert.equal(result[key].length, max);
  assert.equal(validState(result), true);
  const merge = fixture({fire: 0, kills: 6, nextId: 2}); merge.enemies = [drone(1, merge.hero.x + 40, merge.hero.y, {hp: 2, maxHp: 2})]; merge.gems = state.gems; merge.pickups = state.pickups; install(game, merge); advance(game, .3);
  const merged = game.snapshot(); assert.equal(merged.kills, 7); assert.equal(merged.gems.length, MAX_GEMS); assert.equal(merged.gems.reduce((sum, gem) => sum + gem.value, 0), MAX_GEMS + 2); assert.equal(merged.pickups.length, MAX_PICKUPS);
});

test('RNG saves resume deterministically; restore copies state and neutralizes controls', () => {
  const a = setup(), b = setup(() => .9); a.game.reset(); for (let n = 0; n < 35; n++) { playBot(a.game, a.game.snapshot()); a.game.update(.1); } a.game.pointer('cancel', 0, 0); const saved = a.game.snapshot(); install(b.game, saved); assert.deepEqual(b.game.snapshot(), saved);
  const mutable = JSON.parse(JSON.stringify(saved)); install(b.game, mutable); mutable.hero.hp = 1; mutable.upgrades.armor = 3; mutable.enemies.length = 0; assert.notDeepEqual(b.game.snapshot(), mutable);
  for (let n = 0; n < 300; n++) { const current = a.game.snapshot(); if (current.mode !== 'arena') { press(a.game, '1'); press(b.game, '1'); } a.game.update(.05); b.game.update(.05); assert.deepEqual(b.game.snapshot(), a.game.snapshot()); }
  const neutral = setup(), clean = fixture(); install(neutral.game, clean); neutral.game.key('ArrowRight', true); neutral.game.pointer('down', 210, 339); neutral.game.pointer('move', 255, 339); install(neutral.game, clean); neutral.game.update(.1); assert.equal(neutral.game.snapshot().hero.x, clean.hero.x);
});

test('corrupt v2 states are rejected without replacing the current run; drawing stays pure', () => {
  const {game, progress} = setup(); game.reset(); const good = game.snapshot();
  for (const bad of [null, {}, {...good, version: 1}, {...good, room: 0}, {...good, room: 6}, {...good, rng: -1}, {...good, time: Infinity}, {...good, hero: {...good.hero, hp: -1}}, {...good, hero: {...good.hero, shield: 7}}, {...good, hero: {...good.hero, dashTime: 2}}, {...good, status: 'won'}, {...good, mode: 'route'}, {...good, mode: 'upgrade', choices: []}, {...good, mode: 'upgrade', choices: ['repair', 'repair']}, {...good, pendingRoute: 'elite'}, {...good, pickups: [{kind: 'unknown', x: 200, y: 300, ttl: 1}]}, {...good, upgrades: {...good.upgrades, shock: CAPS.shock + 1}}]) { assert.equal(game.restore(bad), false); assert.deepEqual(game.snapshot(), good); }
  const gradient = {addColorStop() {}}, context = new Proxy({createLinearGradient: () => gradient, createRadialGradient: () => gradient}, {get(target, key) {return key in target ? target[key] : () => {};}}), recordBefore = JSON.stringify(progress);
  for (let n = 0; n < 4; n++) game.draw(context); assert.deepEqual(game.snapshot(), good); assert.equal(JSON.stringify(progress), recordBefore);
});

test('only a cleared fifth sector wins, collision death ends once, and restored terminal states stay silent', () => {
  const winning = setup(), final = fixture({room: ROOM_COUNT, time: ROOM_COUNT * ROOM_DURATION, roomTime: ROOM_DURATION, bossSpawned: true}); install(winning.game, final); winning.game.update(1 / 60);
  assert.equal(winning.game.snapshot().status, 'won'); assert.equal(winning.ends.length, 1); assert.equal(winning.ends[0][3], true); assert.equal(winning.progress.robot.wins, 1); assert.equal(validState(winning.game.snapshot()), true);
  advance(winning.game, 1); press(winning.game, ' '); assert.equal(winning.ends.length, 1);
  const restored = setup(); install(restored.game, winning.game.snapshot()); restored.game.update(.1); assert.equal(restored.ends.length, 0);
  const losing = setup(), death = fixture({nextId: 2}); death.hero.hp = 1; death.enemies = [drone(1, death.hero.x, death.hero.y)]; install(losing.game, death); losing.game.update(1 / 60); assert.equal(losing.game.snapshot().status, 'lost'); assert.equal(losing.ends.length, 1); assert.equal(losing.ends[0][3], false); advance(losing.game, 1); assert.equal(losing.ends.length, 1);
});

test('legal-input bot clears five sectors and both bosses across twelve normal seeds', () => {
  for (const seed of [0, .01, .07, .13, .2, .314159, .4, .5, .67, .75, .91, .999999]) {
    const {game, ends} = setup(() => seed); game.reset(); const rooms = new Set(), bosses = new Set(), kinds = new Set(); let routes = 0;
    for (let step = 0; step < 6000 && game.snapshot().status === 'playing'; step++) {
      const state = game.snapshot(); rooms.add(state.room); if (state.mode === 'route') routes++;
      for (const enemy of state.enemies) { kinds.add(enemy.kind); if (enemy.kind === 5) bosses.add(state.room); }
      playBot(game, state); game.update(.1); const after = game.snapshot();
      if (step % 25 === 0) assert.equal(validState(after), true, 'public play produces valid saves');
      assert.ok(after.enemies.length <= MAX_ENEMIES && after.bullets.length <= MAX_BULLETS && after.enemyBullets.length <= MAX_ENEMY_BULLETS);
    }
    const result = game.snapshot(); assert.equal(result.status, 'won', 'normal seed ' + seed + ' is playable without injected states');
    assert.deepEqual([...rooms], [1, 2, 3, 4, 5]); assert.deepEqual([...bosses], [3, 5]); assert.equal(kinds.size, 6); assert.equal(routes, 4);
    assert.ok(result.time >= ROOM_COUNT * ROOM_DURATION && result.time < 600); assert.ok(result.level >= 5); assert.ok(result.kills > 100); assert.equal(result.enemies.length, 0); assert.equal(ends.length, 1);
  }
});



test('late enemies scale, forge advertises and applies extra armor, and bosses have 90/230 HP', () => {
  const {ROUTES} = require('../docs/game.js'); assert.match(ROUTES[0][2], /25/); assert.match(ROUTES[0][2], /15/);
  function firstSpawn(room, roomType) { const {game} = setup(), state = fixture({room, roomType, spawn: 0}); install(game, state); game.update(1 / 60); return game.snapshot(); }
  const normal = firstSpawn(5, 'normal'), elite = firstSpawn(5, 'elite');
  assert.equal(normal.enemies[0].kind, elite.enemies[0].kind); assert.ok(elite.enemies[0].maxHp > normal.enemies[0].maxHp); assert.ok(elite.spawn < normal.spawn, 'forge trades its bonus augment for denser spawns');
  for (const [room, hp] of [[3, 90], [5, 230]]) { const {game} = setup(), state = fixture({room, roomTime: 8, time: room * 32}); install(game, state); game.update(1 / 60); assert.equal(game.snapshot().enemies.find(e => e.kind === 5).maxHp, hp); }
});

test('boss volleys are telegraphed, lock aim, leave a ring passage, and show a wide health bar', () => {
  const {game} = setup(), state = fixture({room: 5, bossSpawned: true, nextId: 2});
  state.enemies = [drone(1, 210, 210, {kind: 5, hp: 230, maxHp: 230, radius: 25, cooldown: 0})]; install(game, state); game.update(1 / 60);
  const warning = game.snapshot(); assert.ok(warning.enemies[0].windup >= .6); assert.equal(warning.enemyBullets.length, 0);
  const locked = [warning.enemies[0].aimX, warning.enemies[0].aimY]; game.key('ArrowRight', true); advance(game, .3); game.key('ArrowRight', false);
  assert.deepEqual([game.snapshot().enemies[0].aimX, game.snapshot().enemies[0].aimY], locked, 'a warned attack cannot track the player afterward');
  advance(game, .55); const fired = game.snapshot(); assert.ok(fired.enemyBullets.length > 0); assert.equal(fired.enemies[0].pattern, 1);
  const ring = fixture({room: 5, bossSpawned: true, nextId: 2}); ring.hero.invuln = 1.3; ring.enemies = [drone(1, 210, 210, {kind: 5, hp: 230, maxHp: 230, radius: 25, windup: .2, cooldown: 0, aimX: 0, aimY: 1, pattern: 1})]; install(game, ring); advance(game, .25);
  const volley = game.snapshot(); assert.ok(volley.enemyBullets.length >= 10 && volley.enemyBullets.length < 16);
  for (const bullet of volley.enemyBullets) { const angle = Math.atan2(bullet.vy, bullet.vx), delta = Math.atan2(Math.sin(angle - Math.PI), Math.cos(angle - Math.PI)); assert.ok(Math.abs(delta) > .5, 'a broad passage remains in the marked direction'); }
  const curves = [], labels = [], gradient = {addColorStop() {}}, context = new Proxy({createLinearGradient: () => gradient, createRadialGradient: () => gradient, arcTo: (...args) => curves.push(args), fillText: (...args) => labels.push(args)}, {get(target, key) {return key in target ? target[key] : () => {};}});
  const before = game.snapshot(); game.draw(context); assert.deepEqual(game.snapshot(), before);
  assert.ok(curves.some(args => args[0] === 340 && args[1] === 86 && args[2] === 340 && args[3] === 96), 'boss health track spans x80..340, i.e. 260px');
  assert.ok(labels.some(args => /NOYAU.*230.*PV/.test(args[0])), 'boss HP is also printed as text');
});

test('route and forge rewards reject contradictory saves; expired projectiles remain saveable', () => {
  const {game} = setup(), before = fixture(); install(game, before);
  const cleared = fixture({room: 3, time: 100, roomTime: ROOM_DURATION, mode: 'route'});
  assert.equal(validState(cleared), false, 'sector three cannot be cleared before its guardian appeared');
  cleared.bossSpawned = true; assert.equal(validState(cleared), true);
  const reward = {...cleared, mode: 'upgrade', choices: ['cannon'], rewardUpgrade: true, pendingRoute: 'elite'}; assert.equal(validState(reward), true);
  for (const bad of [{...reward, rewardUpgrade: false}, {...reward, pendingRoute: null}, {...reward, pendingRoute: 'normal'}, {...reward, room: 5}, {...reward, roomTime: 0}, {...before, bossSpawned: true}]) { assert.equal(game.restore(bad), false); assert.deepEqual(game.snapshot(), before); }
  const expiring = fixture(); expiring.enemyBullets = [{x: 35, y: 145, vx: 0, vy: 0, life: 4, damage: 1}]; install(game, expiring); advance(game, 4); assert.equal(game.snapshot().enemyBullets.length, 0); assert.equal(validState(game.snapshot()), true);
});

test('a different speed/control build can win, while passive play loses', () => {
  let wins = 0;
  for (const seed of [0, .2, .5, .75]) {
    const {game} = setup(() => seed); game.reset(); let coreVolleys = 0, priorPattern = null;
    for (let step = 0; step < 6000 && game.snapshot().status === 'playing'; step++) {
      const current = game.snapshot(), boss = current.room === 5 && current.enemies.find(e => e.kind === 5);
      if (boss) { if (priorPattern !== null && priorPattern !== boss.pattern) coreVolleys++; priorPattern = boss.pattern; }
      playBot(game, current, 'hybrid'); game.update(.1); if (step % 40 === 0) assert.equal(validState(game.snapshot()), true);
    }
    const result = game.snapshot(); if (result.status === 'won') { wins++; assert.ok(result.upgrades.servos >= 1); assert.ok(coreVolleys >= 2, 'a strong build still has to survive multiple boss attacks'); }
  }
  assert.ok(wins >= 3, 'several seeds support a different viable construction');
  for (const seed of [0, .2, .5]) {
    const {game} = setup(() => seed); game.reset();
    for (let step = 0; step < 6000 && game.snapshot().status === 'playing'; step++) { const current = game.snapshot(); if (current.mode === 'upgrade') press(game, '1'); else if (current.mode === 'route') press(game, current.hero.hp < 5 ? '2' : '1'); game.update(.1); }
    assert.equal(game.snapshot().status, 'lost', 'automatic firing and choices alone do not win');
  }
});
