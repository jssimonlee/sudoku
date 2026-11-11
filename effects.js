// === Combo Effects: game-like feedback when a combo hand is banked ===
// Called by combo.js only (so nothing runs while combo mode is off).
// Sounds are synthesized with Web Audio: no audio files needed.
(function () {
    const SETTINGS_KEY = 'sudoku-combo-effects';
    // boardFx: richer effects for the normal Sudoku game (off = the original effects only)
    // effects: combo-mode visuals. sound / vibrate are shared by both.
    const DEFAULT_SETTINGS = { boardFx: true, effects: true, sound: true, vibrate: true };

    // Hand id → effect tier (1 = small … 4 = biggest)
    const TIER_BY_HAND = {
        pair: 1, straight2: 1,
        straight3: 2, triple: 2, twoPair: 2,
        straight4: 3, four: 3,
        fullHouse: 4, straight5: 4, five: 4
    };

    const COLORS = ['#f59e0b', '#fbbf24', '#fb923c', '#f472b6', '#60a5fa', '#34d399', '#a78bfa'];
    const BOARD_COLORS = ['#60a5fa', '#38bdf8', '#34d399', '#a78bfa', '#93c5fd'];
    const LIFE_COLORS = ['#ef4444', '#f87171', '#dc2626', '#fca5a5', '#34d399'];

    const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // === Settings ===
    let settings = loadSettings();

    function loadSettings() {
        try {
            const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
            return { ...DEFAULT_SETTINGS, ...(saved && typeof saved === 'object' ? saved : {}) };
        } catch (e) {
            return { ...DEFAULT_SETTINGS };
        }
    }

    function saveSettings() {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch (e) { /* storage unavailable */ }
    }

    // === Sound (Web Audio synth) ===
    let audioCtx = null;
    let masterGain = null;

    function getAudio() {
        if (!settings.sound) return null;
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        if (!audioCtx) {
            audioCtx = new AudioCtx();
            masterGain = audioCtx.createGain();
            masterGain.gain.value = 0.18;
            masterGain.connect(audioCtx.destination);
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    }

    function tone(freq, start, duration, { type = 'sine', gain = 0.6, slideTo = null } = {}) {
        const ctx = getAudio();
        if (!ctx) return;
        const t0 = ctx.currentTime + start;
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
        env.gain.setValueAtTime(0.0001, t0);
        env.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
        osc.connect(env);
        env.connect(masterGain);
        osc.start(t0);
        osc.stop(t0 + duration + 0.05);
    }

    // C major notes (Hz)
    const N = { C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5, E6: 1318.5, G6: 1568, C7: 2093 };

    const SOUNDS = {
        1() {
            tone(N.G5 * 1.5, 0, 0.08, { type: 'square', gain: 0.25 });
        },
        2() {
            tone(N.E5, 0, 0.18, { type: 'triangle' });
            tone(N.C6, 0.09, 0.3, { type: 'triangle' });
        },
        3() {
            [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone(f, i * 0.07, 0.28, { type: 'triangle', gain: 0.5 }));
            tone(N.E6, 0.3, 0.4, { type: 'sine', gain: 0.35 });
        },
        4() {
            [N.C5, N.E5, N.G5, N.C6, N.E6].forEach((f, i) => tone(f, i * 0.06, 0.25, { type: 'square', gain: 0.18 }));
            [N.C5, N.E5, N.G5, N.C6].forEach((f) => tone(f, 0.34, 0.9, { type: 'triangle', gain: 0.35 }));
            [N.G6, N.C7, N.G6, N.C7].forEach((f, i) => tone(f, 0.42 + i * 0.08, 0.12, { type: 'sine', gain: 0.18 }));
        },
        break() {
            tone(160, 0, 0.32, { type: 'sawtooth', gain: 0.22, slideTo: 60 });
            tone(90, 0.02, 0.25, { type: 'sine', gain: 0.5, slideTo: 45 });
        },

        // --- Normal game ---
        // Each number has its own note (1 = C5 … 9 = D6), so input order plays a melody.
        pop(val) {
            const f = SCALE[val] || N.C5;
            tone(f, 0, 0.14, { type: 'sine', gain: 0.35 });
            tone(f * 2, 0, 0.06, { type: 'triangle', gain: 0.08 });
        },
        unit(count) {
            const notes = count >= 2 ? [N.C6, N.E6, N.G6, N.C7] : [N.G5, N.C6, N.E6];
            notes.forEach((f, i) => tone(f, 0.05 + i * 0.06, 0.22, { type: 'triangle', gain: 0.32 }));
        },
        number() {
            [N.C5, N.G5, N.C6, N.E6, N.G6].forEach((f, i) => tone(f, i * 0.05, 0.3, { type: 'sine', gain: 0.32 }));
        },
        win() {
            [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone(f, i * 0.12, 0.2, { type: 'square', gain: 0.16 }));
            [N.C5, N.E5, N.G5, N.C6, N.E6].forEach((f) => tone(f, 0.5, 1.3, { type: 'triangle', gain: 0.28 }));
            [N.C7, N.G6, N.C7, N.E6, N.G6, N.C7].forEach((f, i) => tone(f, 0.6 + i * 0.09, 0.12, { type: 'sine', gain: 0.14 }));
        },
        mistake() {
            tone(220, 0, 0.18, { type: 'square', gain: 0.14, slideTo: 150 });
            tone(110, 0, 0.2, { type: 'sine', gain: 0.35 });
        },
        // Losing a life: a falling "hit" that gets lower as lives run out.
        lifeLost(livesLeft) {
            const base = livesLeft >= 2 ? 330 : 260;
            tone(base, 0, 0.12, { type: 'square', gain: 0.16, slideTo: base * 0.6 });
            tone(base * 0.75, 0.12, 0.22, { type: 'square', gain: 0.14, slideTo: base * 0.4 });
            tone(90, 0, 0.3, { type: 'sine', gain: 0.4 });
        },
        lifeOut() {
            [392, 330, 262, 196].forEach((f, i) => tone(f, i * 0.16, 0.2, { type: 'square', gain: 0.14, slideTo: f * 0.94 }));
            tone(70, 0.6, 0.7, { type: 'sine', gain: 0.45, slideTo: 45 });
        }
    };

    const SCALE = { 1: 523.25, 2: 587.33, 3: 659.25, 4: 698.46, 5: 783.99, 6: 880, 7: 987.77, 8: 1046.5, 9: 1174.66 };

    function playSound(name, arg) {
        if (!settings.sound) return;
        try {
            SOUNDS[name](arg);
        } catch (e) { /* audio unavailable */ }
    }

    // === Vibration ===
    const VIBRATION = { tap: 10, 3: 40, 4: [60, 40, 60, 40, 120], break: 90, unit: 25, number: 40, win: [80, 50, 80, 50, 200], mistake: [70, 40, 50], lifeOut: [120, 60, 120, 60, 300] };

    function vibrate(name) {
        if (!settings.vibrate || !VIBRATION[name] || !navigator.vibrate) return;
        // Browsers block vibration before the first tap.
        if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
        try {
            navigator.vibrate(VIBRATION[name]);
        } catch (e) { /* not supported */ }
    }

    // === Particles (one shared canvas, loop runs only while particles exist) ===
    let canvas = null;
    let ctx2d = null;
    let particles = [];
    let rafId = null;

    function ensureCanvas() {
        if (canvas) return;
        canvas = document.createElement('canvas');
        canvas.className = 'fx-canvas';
        document.body.appendChild(canvas);
        ctx2d = canvas.getContext('2d');
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
    }

    function resizeCanvas() {
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function randomColor(palette = COLORS) {
        return palette[Math.floor(Math.random() * palette.length)];
    }

    function burst(x, y, count, speed, palette = COLORS) {
        ensureCanvas();
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const v = speed * (0.4 + Math.random() * 0.8);
            particles.push({
                x, y,
                vx: Math.cos(angle) * v,
                vy: Math.sin(angle) * v - speed * 0.3,
                gravity: 0.18,
                drag: 0.96,
                size: 2 + Math.random() * 3,
                color: randomColor(palette),
                life: 1,
                decay: 0.018 + Math.random() * 0.015,
                shape: 'dot'
            });
        }
        startLoop();
    }

    function confetti(count) {
        ensureCanvas();
        const w = window.innerWidth;
        for (let i = 0; i < count; i++) {
            particles.push({
                x: Math.random() * w,
                y: -20 - Math.random() * window.innerHeight * 0.4,
                vx: (Math.random() - 0.5) * 2,
                vy: 2 + Math.random() * 3,
                gravity: 0.05,
                drag: 0.995,
                size: 5 + Math.random() * 5,
                color: randomColor(),
                life: 1,
                decay: 0.004 + Math.random() * 0.003,
                rotation: Math.random() * Math.PI,
                spin: (Math.random() - 0.5) * 0.3,
                shape: 'rect'
            });
        }
        startLoop();
    }

    function startLoop() {
        if (rafId === null) rafId = requestAnimationFrame(step);
    }

    function step() {
        ctx2d.clearRect(0, 0, window.innerWidth, window.innerHeight);
        const height = window.innerHeight;
        particles = particles.filter((p) => p.life > 0 && p.y < height + 40);

        for (const p of particles) {
            p.vx *= p.drag;
            p.vy = p.vy * p.drag + p.gravity;
            p.x += p.vx;
            p.y += p.vy;
            p.life -= p.decay;
            ctx2d.globalAlpha = Math.max(0, Math.min(1, p.life));
            ctx2d.fillStyle = p.color;
            if (p.shape === 'rect') {
                p.rotation += p.spin;
                ctx2d.save();
                ctx2d.translate(p.x, p.y);
                ctx2d.rotate(p.rotation);
                ctx2d.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
                ctx2d.restore();
            } else {
                ctx2d.beginPath();
                ctx2d.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx2d.fill();
            }
        }
        ctx2d.globalAlpha = 1;

        if (particles.length > 0) {
            rafId = requestAnimationFrame(step);
        } else {
            ctx2d.clearRect(0, 0, window.innerWidth, window.innerHeight);
            rafId = null;
        }
    }

    // === DOM effects ===
    function getCell(key) {
        return document.querySelector(`.cell[data-row="${Math.floor(key / 9)}"][data-col="${key % 9}"]`);
    }

    function center(el) {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }

    function restartClass(el, className, duration) {
        if (!el) return;
        el.classList.remove(className);
        void el.offsetWidth; // reflow to restart the animation
        el.classList.add(className);
        // An older timer for the same class must not cut this run short.
        const timers = el._fxTimers || (el._fxTimers = {});
        clearTimeout(timers[className]);
        timers[className] = setTimeout(() => el.classList.remove(className), duration);
    }

    // Board cell effects: short and light so fast play is never blocked.
    const CORRECT_MS = 320;
    const STAMP_MS = 300;
    const WAVE_MS = 380;
    const WAVE_STEP_MS = 20;
    let waveTimers = [];

    // The next move (tap or key) ends any sweep still running, so effects never pile up.
    function clearBoardWaves() {
        waveTimers.forEach(clearTimeout);
        waveTimers = [];
        document.querySelectorAll('.cell.fx-unit-wave, .cell.fx-correct, .cell.fx-unit-hop, .cell.fx-stamp').forEach((el) => {
            el.classList.remove('fx-unit-wave', 'fx-correct', 'fx-unit-hop', 'fx-stamp');
        });
    }

    // === Numpad feel: a button dips and springs back when its number is played ===
    function numButton(val) {
        return document.querySelector(`.num-btn[data-val="${val}"]`);
    }

    function pressNumButton(btn) {
        if (!settings.boardFx || reducedMotion || !btn || btn.classList.contains('disabled')) return;
        restartClass(btn, 'fx-press', 260);
    }

    document.addEventListener('click', (e) => {
        const btn = e.target.closest && e.target.closest('.num-btn');
        if (btn) pressNumButton(btn);
    });
    // Typing 1-9 presses the matching button too (skipped while a popup has the keyboard).
    document.addEventListener('keydown', (e) => {
        if (e.key >= '1' && e.key <= '9' && !e.ctrlKey && !e.metaKey && !e.altKey) pressNumButton(numButton(e.key));
    });
    document.addEventListener('pointerdown', clearBoardWaves, true);
    window.addEventListener('keydown', clearBoardWaves, true);

    // Light up the hand's cells in input order.
    function cellWave(keys, tier) {
        const delay = tier === 1 ? 0 : 90;
        keys.forEach((key, i) => {
            const cell = getCell(key);
            if (!cell) return;
            setTimeout(() => {
                cell.style.setProperty('--fx-tier', tier);
                restartClass(cell, `fx-cell-hit-${tier}`, 900);
            }, i * delay);
        });
    }

    function floatText(text, anchor, tier, extraClass = '') {
        if (!anchor) return;
        const { x, y } = center(anchor);
        const el = document.createElement('div');
        el.className = `fx-float fx-float-${tier} ${extraClass}`.trim();
        el.textContent = text;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 1100);
    }

    let countUpId = null;
    function countUp(el, from, to, duration, getLatest) {
        if (!el || from === to) return;
        cancelAnimationFrame(countUpId);
        const start = performance.now();
        const tick = (now) => {
            if (getLatest() !== to) return; // score changed (e.g. undo): stop and keep render's value
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            el.textContent = Math.round(from + (to - from) * eased).toLocaleString();
            if (t < 1) countUpId = requestAnimationFrame(tick);
        };
        countUpId = requestAnimationFrame(tick);
    }

    function banner(titleText, subText, tier, extraClass = '') {
        const el = document.createElement('div');
        el.className = `fx-banner fx-banner-${tier} ${extraClass}`.trim();
        const title = document.createElement('strong');
        title.textContent = titleText;
        const sub = document.createElement('span');
        sub.textContent = subText;
        el.append(title, sub);

        if (tier >= 4) {
            document.body.appendChild(el);
        } else {
            const board = document.querySelector('.board-container');
            if (!board) return;
            board.appendChild(el);
        }
        setTimeout(() => el.remove(), tier >= 4 ? 1800 : 1200);
    }

    // Red vignette over the whole screen (level 1-3).
    function screenFlash(level) {
        const el = document.createElement('div');
        el.className = `fx-screen-flash fx-screen-flash-${Math.max(1, Math.min(3, level))}`;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 700);
    }

    function shake(strength) {
        if (reducedMotion) return;
        restartClass(document.querySelector('.board-container'), `fx-shake-${strength}`, 500);
    }

    // Drop the current hand's chips off the panel.
    function shatterChips() {
        if (reducedMotion) return;
        document.querySelectorAll('#combo-slots .combo-chip:not(.empty)').forEach((chip, i) => {
            const r = chip.getBoundingClientRect();
            const clone = chip.cloneNode(true);
            clone.classList.add('fx-chip-shatter');
            clone.style.left = `${r.left}px`;
            clone.style.top = `${r.top}px`;
            clone.style.width = `${r.width}px`;
            clone.style.height = `${r.height}px`;
            clone.style.setProperty('--fx-dx', `${(Math.random() - 0.5) * 80}px`);
            clone.style.setProperty('--fx-rot', `${(Math.random() - 0.5) * 120}deg`);
            clone.style.animationDelay = `${i * 40}ms`;
            document.body.appendChild(clone);
            setTimeout(() => clone.remove(), 900 + i * 40);
        });
    }

    let lastBankAt = -Infinity;

    // === Completed row / column / box: each shape gets its own flash ===
    function unitShape(unit) {
        if (unit.every(([ur]) => ur === unit[0][0])) return 'row';
        if (unit.every(([, uc]) => uc === unit[0][1])) return 'col';
        return 'box';
    }

    // A bar of light over a line, or a square that pops over a box.
    function unitBeam(unit) {
        const first = getCell(unit[0][0] * 9 + unit[0][1]);
        const last = getCell(unit[8][0] * 9 + unit[8][1]);
        if (!first || !last) return;
        const a = first.getBoundingClientRect();
        const b = last.getBoundingClientRect();
        const el = document.createElement('div');
        el.className = `fx-beam fx-beam-${unitShape(unit)}`;
        el.style.left = `${a.left}px`;
        el.style.top = `${a.top}px`;
        el.style.width = `${b.right - a.left}px`;
        el.style.height = `${b.bottom - a.top}px`;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 650);
    }

    // === Public API (combo events from combo.js, game events from script.js) ===
    const api = {
        // { id, name, points, keys, prevScore, score, streak, getScore }
        onBank(hand) {
            lastBankAt = performance.now();
            const baseTier = TIER_BY_HAND[hand.id] || 1;
            playSound(baseTier);
            vibrate(baseTier);
            if (!settings.effects) return;

            // Heat: a long streak makes the visuals one notch stronger.
            const tier = hand.streak >= 5 ? Math.min(4, baseTier + 1) : baseTier;
            const heat = 1 + Math.min(hand.streak, 5) * 0.15;
            const scoreEl = document.getElementById('combo-score');
            const board = document.querySelector('.sudoku-board');

            cellWave(hand.keys, tier);
            floatText(`+${hand.points}`, scoreEl, tier);
            restartClass(scoreEl, 'fx-score-pop', 500);

            if (tier >= 2) {
                countUp(scoreEl, hand.prevScore, hand.score, 300 + tier * 150, hand.getScore);
                const last = getCell(hand.keys[hand.keys.length - 1]);
                if (last) {
                    const { x, y } = center(last);
                    burst(x, y, Math.round(14 * heat), 4);
                }
            }

            if (tier >= 3) {
                banner(`${hand.name}!`, `+${hand.points}`, tier);
                if (board) {
                    const { x, y } = center(board);
                    burst(x, y, Math.round((tier === 3 ? 40 : 70) * heat), tier === 3 ? 7 : 9);
                }
                shake(tier === 3 ? 'small' : 'big');
            }

            if (tier >= 4) {
                restartClass(document.querySelector('.board-container'), 'fx-board-glow', 1400);
                if (!reducedMotion) confetti(Math.round(120 * heat));
            }
        },

        // The unbanked hand was lost (mistake). hadCards: there were chips to drop.
        onBreak({ hadCards }) {
            if (!hadCards) return;
            playSound('break');
            vibrate('break');
            if (settings.effects) shatterChips();
        },

        // --- Normal game (only when boardFx is on; off keeps the original effects) ---

        // units: completed row/col/box, each a list of [r, c] in board order.
        onCorrectInput({ r, c, val, units }) {
            if (!settings.boardFx) return;
            // A combo hand banked by this same input already played its sound.
            const comboSounded = performance.now() - lastBankAt < 80;
            if (!comboSounded) playSound('pop', val);

            const cell = getCell(r * 9 + c);
            if (cell) {
                restartClass(cell, 'fx-correct', CORRECT_MS);
                // The number lands on the cell like a stamp.
                if (!reducedMotion) restartClass(cell, 'fx-stamp', STAMP_MS);
                const { x, y } = center(cell);
                burst(x, y, 6, 2, BOARD_COLORS);
            }
            vibrate('tap');

            if (!units || units.length === 0) return;

            units.forEach((unit) => {
                // A light sweep outward from the cell that completed the line (~0.5s in total),
                // with every number in it hopping in the same order.
                unit.slice()
                    .sort((a, b) => (Math.abs(a[0] - r) + Math.abs(a[1] - c)) - (Math.abs(b[0] - r) + Math.abs(b[1] - c)))
                    .forEach(([ur, uc], i) => {
                        const unitCell = getCell(ur * 9 + uc);
                        waveTimers.push(setTimeout(() => restartClass(unitCell, 'fx-unit-wave', WAVE_MS), i * WAVE_STEP_MS));
                        if (unitCell && !reducedMotion) {
                            unitCell.style.setProperty('--fx-i', i);
                            restartClass(unitCell, 'fx-unit-hop', 420 + i * WAVE_STEP_MS);
                        }
                    });
                unitBeam(unit);
                const mid = getCell(unit[4][0] * 9 + unit[4][1]);
                if (mid) {
                    const { x, y } = center(mid);
                    burst(x, y, unitShape(unit) === 'box' ? 18 : 12, 3.5, BOARD_COLORS);
                }
            });

            playSound('unit', units.length);
            vibrate('unit');
            if (units.length >= 2 && cell) {
                floatText(units.length === 2 ? '더블 라인!' : '트리플 라인!', cell, units.length === 2 ? 3 : 4, 'fx-float-board');
                shake(units.length === 2 ? 'small' : 'big');
                const board = document.querySelector('.board-container');
                if (units.length >= 3 && board) {
                    const { x, y } = center(board);
                    burst(x, y, 50, 7, BOARD_COLORS.concat(COLORS));
                    restartClass(board, 'fx-board-pulse', 700);
                }
            }
        },

        onNumberComplete({ val, btn }) {
            if (!settings.boardFx) return;
            playSound('number');
            vibrate('number');
            if (btn) {
                floatText(`${val} 완성!`, btn, 2, 'fx-float-board');
                const { x, y } = center(btn);
                burst(x, y, 22, 5, BOARD_COLORS);
            }
        },

        onWin() {
            if (!settings.boardFx) return;
            playSound('win');
            vibrate('win');
            const boardBox = document.querySelector('.board-container');
            restartClass(boardBox, 'fx-board-glow', 1400);
            banner('퍼즐 완성!', '축하합니다', 4, 'fx-banner-board');
            if (boardBox) {
                const { x, y } = center(boardBox);
                burst(x, y, 60, 9, BOARD_COLORS.concat(COLORS));
            }
            if (!reducedMotion) confetti(170);
        },

        // A life was lost. bar: the health bar that just emptied, livesLeft: lives remaining.
        onMistake({ r, c, bar, livesLeft } = {}) {
            if (!settings.boardFx) return;
            const final = livesLeft === 0;
            playSound(final ? 'lifeOut' : 'lifeLost', livesLeft);
            vibrate(final ? 'lifeOut' : 'mistake');

            // The emptied bar cracks and shatters into red shards.
            if (bar) {
                restartClass(bar, 'fx-life-lost', 700);
                const { x, y } = center(bar);
                burst(x, y, final ? 30 : 16, final ? 5 : 3.5, LIFE_COLORS);
                floatText('-1', bar, 2, 'fx-float-life');
            }

            const cell = Number.isInteger(r) ? getCell(r * 9 + c) : null;
            if (cell) {
                const { x, y } = center(cell);
                burst(x, y, 10, 3, LIFE_COLORS);
            }

            // Red flash around the screen edges, stronger as lives run out.
            screenFlash(final ? 3 : 3 - livesLeft);
            shake(final || livesLeft === 1 ? 'big' : 'small');

            if (livesLeft === 1) banner('마지막 기회!', '한 번 더 틀리면 끝', 3, 'fx-banner-life');
        }
    };

    // === Settings UI (inside the paytable popup + quick sound button) ===
    function bindSettingsUI() {
        const inputs = {
            boardFx: document.getElementById('fx-setting-board'),
            effects: document.getElementById('fx-setting-effects'),
            sound: document.getElementById('fx-setting-sound'),
            vibrate: document.getElementById('fx-setting-vibrate')
        };
        const soundBtn = document.getElementById('combo-sound-btn');
        const headerBtn = document.getElementById('fx-toggle');
        const modal = document.getElementById('fx-modal');
        const modalClose = document.getElementById('fx-modal-close');
        const comboOpenBtn = document.getElementById('combo-open-fx');
        let returnFocus = null;

        function openModal() {
            returnFocus = document.activeElement;
            // Opening from the combo paytable: swap popups.
            const comboModal = document.getElementById('combo-modal');
            if (comboModal && !comboModal.hidden) comboModal.hidden = true;
            modal.hidden = false;
            modalClose.focus();
        }

        function closeModal() {
            modal.hidden = true;
            if (returnFocus && document.contains(returnFocus) && returnFocus.offsetParent !== null) returnFocus.focus();
            else if (headerBtn) headerBtn.focus();
        }

        if (modal) {
            if (headerBtn) headerBtn.addEventListener('click', openModal);
            if (comboOpenBtn) comboOpenBtn.addEventListener('click', openModal);
            modalClose.addEventListener('click', closeModal);
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeModal();
            });
            // Capture before the game's keydown handler so keys don't play moves.
            window.addEventListener('keydown', (e) => {
                if (modal.hidden) return;
                e.stopPropagation();
                if (e.key === 'Escape') {
                    e.preventDefault();
                    closeModal();
                }
            }, true);
        }

        function sync() {
            // Lets CSS gate persistent rich effects (e.g. the last-life pulse).
            document.body.classList.toggle('fx-rich', !!settings.boardFx);
            if (headerBtn) {
                headerBtn.classList.toggle('fx-active', !!settings.boardFx);
                headerBtn.title = settings.boardFx ? '화려한 효과 켜짐 (설정 열기)' : '화려한 효과 꺼짐 (설정 열기)';
            }
            Object.entries(inputs).forEach(([key, input]) => {
                if (input) input.checked = !!settings[key];
            });
            if (soundBtn) {
                soundBtn.classList.toggle('muted', !settings.sound);
                soundBtn.setAttribute('aria-pressed', String(settings.sound));
                soundBtn.title = settings.sound ? '소리 끄기' : '소리 켜기';
                const icon = soundBtn.querySelector('i');
                if (icon) icon.className = settings.sound ? 'fas fa-volume-up' : 'fas fa-volume-mute';
            }
        }

        Object.entries(inputs).forEach(([key, input]) => {
            if (!input) return;
            input.addEventListener('change', () => {
                settings[key] = input.checked;
                saveSettings();
                sync();
                if (key === 'sound' && settings.sound) playSound(1);
            });
        });

        if (soundBtn) {
            soundBtn.addEventListener('click', () => {
                settings.sound = !settings.sound;
                saveSettings();
                sync();
                if (settings.sound) playSound(1);
            });
        }

        // Hide the vibration option where the device can't vibrate.
        if (!navigator.vibrate && inputs.vibrate) {
            const row = inputs.vibrate.closest('.fx-setting');
            if (row) row.hidden = true;
        }

        sync();
    }

    bindSettingsUI();
    window.GameEffects = api;
    window.ComboEffects = api;
})();
