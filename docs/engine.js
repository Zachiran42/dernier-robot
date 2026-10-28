'use strict';
(() => {
  const config = window.APP;
  const element = id => document.getElementById(id);
  const canvas = element('game');
  const context = canvas.getContext('2d');
  if (new URLSearchParams(location.search).has('native')) document.body.classList.add('native');

  const key = 'offline.' + config.slug + '.v1';
  const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const copy = value => JSON.parse(JSON.stringify(value));
  let stored;
  try { stored = JSON.parse(localStorage.getItem(key) || '{}'); } catch { stored = {}; }
  if (!isRecord(stored)) stored = {};
  const state = {
    progress: isRecord(stored.progress) ? copy(stored.progress) : {},
    saved: isRecord(stored.saved) ? copy(stored.saved) : null,
    best: Number.isFinite(Number(stored.best)) ? Math.max(0, Number(stored.best)) : 0
  };
  let game = null;
  let preview = null;
  let paused = true;
  let started = false;
  let ended = false;
  let won = false;
  let transitioning = false;
  let last = 0;
  let saveClock = 0;
  let hudText = '';
  let pointerId = null;
  const heldKeys = new Set();

  function store() {
    // The home preview must never replace a saved game or normalize its progress.
    if (!started || transitioning) return;
    try {
      state.progress = api.progress;
      state.saved = ended ? null : game.snapshot();
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      element('hint').textContent = 'Sauvegarde indisponible sur cet appareil.';
    }
  }
  function clearInput() {
    const active = game || preview;
    const captured = pointerId;
    pointerId = null;
    if (captured !== null) {
      try { canvas.releasePointerCapture(captured); } catch { /* Already released by the browser. */ }
    }
    if (active) {
      try { active.pointer('cancel', 0, 0); } catch { /* Input cleanup must finish. */ }
      for (const pressed of heldKeys) {
        try { active.key(pressed, false); } catch { /* Release the remaining keys too. */ }
      }
    }
    heldKeys.clear();
  }
  function show(title, text, button, mode) {
    element('overlay-title').textContent = title;
    element('overlay-text').textContent = text;
    element('play').textContent = button;
    element('overlay').dataset.mode = mode;
    element('overlay').hidden = false;
    element('restart').hidden = mode === 'home' && !state.saved;
    element('record').textContent = state.best ? 'Meilleur score · ' + state.best : 'Hors ligne · Sans compte · Sans publicité';
    element('play').focus({ preventScroll: true });
  }
  const api = {
    progress: state.progress,
    hud(...values) {
      const text = JSON.stringify(values);
      if (text === hudText) return;
      hudText = text;
      for (let i = 0; i < 3; i++) {
        const box = element('hud').children[i];
        box.children[0].textContent = values[i * 2] ?? '';
        box.children[1].textContent = values[i * 2 + 1] ?? '—';
      }
    },
    toast(text) { element('hint').textContent = text; },
    save: store,
    end(title, text, score, isWon) {
      if (!started || ended || transitioning) return;
      ended = true;
      won = !!isWon;
      paused = true;
      clearInput();
      const value = Number(score);
      if (Number.isFinite(value)) state.best = Math.max(state.best, value);
      state.saved = null;
      store();
      show(title, text, won && typeof game.next === 'function' ? 'Continuer' : 'Rejouer', 'end');
    }
  };
  function makeGame(progress) {
    api.progress = copy(progress);
    state.progress = api.progress;
    return window.createGame(api);
  }
  function start(fresh) {
    const saved = !fresh && state.saved ? copy(state.saved) : null;
    const progress = copy(state.progress);
    transitioning = true;
    clearInput();
    ended = false;
    won = false;
    let loaded = false;
    try {
      game = makeGame(progress);
      if (saved) {
        try { loaded = game.restore(copy(saved)) !== false; } catch { loaded = false; }
        // A crash between a game's own save and its end callback can leave a terminal snapshot.
        const snapshot = loaded ? game.snapshot() : null;
        if (snapshot && (snapshot.finished === true || snapshot.status === 'won' || snapshot.status === 'lost')) loaded = false;
      }
      if (!loaded) {
        // restore() may have changed its input or progression before rejecting it.
        if (saved) game = makeGame(progress);
        game.reset();
      }
    } catch {
      // Malformed progression must not make the application impossible to open.
      game = makeGame({});
      game.reset();
    }
    transitioning = false;
    started = true;
    paused = false;
    pointerId = null;
    saveClock = 0;
    element('overlay').hidden = true;
    last = performance.now();
    store();
    canvas.focus({ preventScroll: true });
  }
  function pause() {
    if (!started || ended || paused) return false;
    paused = true;
    clearInput();
    store();
    show('Une petite pause ?', 'Ta partie est sauvegardée sur cet appareil. Reprends quand tu veux.', 'Reprendre', 'pause');
    return true;
  }
  function resume() {
    clearInput();
    paused = false;
    saveClock = 0;
    element('overlay').hidden = true;
    last = performance.now();
    canvas.focus({ preventScroll: true });
  }
  element('play').onclick = () => {
    const mode = element('overlay').dataset.mode;
    if (mode === 'pause') resume();
    else if (mode === 'end' && won && typeof game.next === 'function') {
      clearInput();
      transitioning = true;
      ended = false;
      won = false;
      game.next();
      transitioning = false;
      resume();
      store();
    } else start(false);
  };
  element('restart').onclick = () => start(true);
  element('pause').onclick = pause;

  function position(event) {
    const bounds = canvas.getBoundingClientRect();
    return [(event.clientX - bounds.left) * 420 / (bounds.width || 420), (event.clientY - bounds.top) * 600 / (bounds.height || 600)];
  }
  canvas.addEventListener('pointerdown', event => {
    if (paused || pointerId !== null) return;
    pointerId = event.pointerId;
    try { canvas.setPointerCapture(pointerId); } catch { /* Synthetic or interrupted pointer. */ }
    game.pointer('down', ...position(event));
    event.preventDefault();
  });
  for (const [name, type] of [['pointermove', 'move'], ['pointerup', 'up'], ['pointercancel', 'cancel']]) {
    canvas.addEventListener(name, event => {
      if (pointerId !== event.pointerId) return;
      if (!paused) game.pointer(type, ...position(event));
      if (type === 'up' || type === 'cancel') pointerId = null;
      event.preventDefault();
    });
  }
  canvas.addEventListener('lostpointercapture', event => {
    if (pointerId !== event.pointerId) return;
    pointerId = null;
    game.pointer('cancel', 0, 0);
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' || event.key.toLowerCase() === 'p') { pause(); return; }
    if (paused) return;
    if (event.key.startsWith('Arrow') || event.key === ' ') event.preventDefault();
    heldKeys.add(event.key);
    game.key(event.key, true);
  });
  window.addEventListener('keyup', event => {
    heldKeys.delete(event.key);
    if (game) game.key(event.key, false);
  });
  window.addEventListener('blur', pause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('pagehide', () => { pause(); store(); });
  window.__pauseGame = pause;
  window.__handleBack = () => {
    if (!started || ended || paused) return false;
    pause();
    return true;
  };
  window.arcade = { get game() { return game || preview; }, api, pause, save: store };

  function frame(time) {
    const dt = Math.min(0.04, Math.max(0, (time - last) / 1000));
    last = time;
    if (!paused) {
      game.update(dt);
      saveClock += dt;
      if (saveClock > 2) { saveClock = 0; store(); }
    }
    context.clearRect(0, 0, 420, 600);
    (game || preview).draw(context);
    requestAnimationFrame(frame);
  }
  // The preview has its own progression and cannot write to localStorage.
  function makePreview(progress) {
    const previewApi = { ...api, progress: copy(progress), save() {}, end() {} };
    const result = window.createGame(previewApi);
    result.reset();
    return result;
  }
  try { preview = makePreview(state.progress); } catch { preview = makePreview({}); }
  show(config.title, config.description, state.saved ? 'Reprendre ma partie' : 'Jouer', 'home');
  requestAnimationFrame(frame);
})();