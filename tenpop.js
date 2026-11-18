// 합 10 지우기: a bonus game played on the board you just solved.
// Draw an unbroken path (up/down/left/right, any shape: straight, ㄱ, ㄷ, ㄹ...) over numbers
// that add up to 10 or 20 (20 is a "double ten" worth x1.5). The path disappears and the
// numbers above fall down. Nothing new comes in.
//
// Extras:
// - Time survival: 60 seconds to start; every clear buys a little more time.
// - Shape bonus: a straight run is the hardest to find, so it pays the most.
// - Chain: after a fall, two numbers that newly touch and make 10 pop on their own, again and again.
// - Fever: quick clears fill the fever gauge; when it is full, points are doubled for 10 seconds.
// - Special cells: ★ doubles that clear, 💣 also blows up its four neighbours, 🧊 needs two hits.
// - Items (won by combos and fever): 🔨 breaks one cell, 🔄 swaps two neighbours, 🃏 turns a cell
//   into a joker that counts as whatever number the path needs. When a hammer or a swap lines up
//   a new straight 10 or 20, it pops at once.
(() => {
    const SIZE = 9;
    const COMBO_WINDOW_MS = 2500;
    const POP_MS = 180;
    const CHAIN_WAIT_MS = 260;      // after the fall, before a chain pops
    const FEVER_MS = 10000;
    const FEVER_MAX = 100;
    const SPECIALS = { star: 3, bomb: 2, ice: 2 };
    const BEST_KEY = 'sudoku-tenpop-best';
    const TARGETS = [20, 10];       // a path clears when it adds up to one of these (20 checked first)
    const MAX_TARGET = 20;
    const DOUBLE_MULT = 1.5;        // bonus for a 20
    const START_TIME_MS = 60000;
    const MAX_TIME_MS = 99000;
    const JOKER = -1;               // grid value of a joker cell
    const ITEM_MAX = 3;
    const ITEMS = {
        hammer: { icon: '🔨', name: '망치', hint: '깰 칸을 누르세요' },
        swap: { icon: '🔄', name: '바꾸기', hint: '서로 바꿀 이웃한 두 칸을 차례로 누르세요' },
        joker: { icon: '🃏', name: '조커', hint: '조커로 바꿀 칸을 누르세요 (아무 숫자로 쓰임)' }
    };

    // Points for one clear by how many cells it takes; longer paths are worth more.
    function basePoints(len) {
        if (len <= 2) return 20;
        if (len === 3) return 40;
        if (len === 4) return 70;
        return 100 + (len - 5) * 40;
    }

    function comboMultiplier(combo) {
        return Math.min(3, 1 + 0.25 * (combo - 1));
    }

    // Shape of a path by its turns. Two cells are just a pair.
    function shapeOf(path) {
        if (path.length <= 2) return { name: '짝', mult: 1 };
        const dirs = [];
        for (let i = 1; i < path.length; i++) dirs.push([path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]]);
        const turnSigns = [];
        for (let i = 1; i < dirs.length; i++) {
            const [ar, ac] = dirs[i - 1];
            const [br, bc] = dirs[i];
            if (ar !== br || ac !== bc) turnSigns.push(Math.sign(ar * bc - ac * br));
        }
        const turns = turnSigns.length;
        if (turns === 0) return { name: '일자', mult: 1.5 };
        if (turns === 1) return { name: 'ㄱ자', mult: 1.2 };
        if (path.length >= 6) return { name: '뱀', mult: 1 };
        if (turns === 2 && turnSigns[0] === turnSigns[1]) return { name: 'ㄷ자', mult: 1 };
        return { name: 'ㄹ자', mult: 1 };
    }

    // The target (20 or 10) a set of cells can make, or 0. A joker counts as any number 1-9.
    function reach(fixed, jokers, len) {
        if (len < 2) return 0;
        for (const t of TARGETS) {
            if (fixed + jokers <= t && t <= fixed + 9 * jokers) return t;
        }
        return 0;
    }

    function fx(name, payload) {
        const api = window.GameEffects;
        if (api && typeof api[name] === 'function') api[name](payload);
    }

    function loadBest() {
        try {
            const saved = JSON.parse(localStorage.getItem(BEST_KEY));
            if (saved && typeof saved === 'object') return saved;
        } catch (e) { /* storage unavailable */ }
        return { score: 0, left: null, combo: 0, chain: 0, plays: 0 };
    }

    function saveBest(best) {
        try {
            localStorage.setItem(BEST_KEY, JSON.stringify(best));
        } catch (e) { /* storage unavailable */ }
    }

    // === State ===
    let startGrid = null;   // the solved board, kept for "다시 하기"
    let grid = [];          // numbers, 0 = empty, JOKER = joker
    let special = [];       // null | { type: 'star' | 'bomb' | 'ice', hp }
    let score = 0;
    let combo = 0;
    let maxCombo = 0;
    let maxChain = 0;
    let cleared = 0;
    let lastClearAt = 0;
    let comboTimer = null;
    let fever = 0;
    let feverOn = false;
    let feverTimer = null;
    let shufflesLeft = 1;
    let items = { hammer: 1, swap: 1, joker: 0 };
    let itemMode = null;    // 'hammer' | 'swap' | 'joker' while an item is being used
    let swapFirst = null;
    let timeLeft = START_TIME_MS;
    let playMs = 0;
    let timerId = null;
    let lastTick = 0;
    let lastBeep = 0;
    let busy = false;
    let finished = false;
    let anchor = null;      // [r, c] picked by a tap, waiting for the other end of a straight line
    let drag = null;        // { path: [[r, c]...], moved }
    let lastStepKey = '';
    let gameId = 0;         // timers from an earlier game (closed or restarted mid-chain) stop themselves

    // === DOM (built once, on first open) ===
    let root, boardEl, pathSvg, pathLine, cells, timeEl, timeBox, scoreEl, comboEl, leftEl, gaugeEl,
        feverBar, feverFill, hintEl, itemBtns, shuffleBtn, finishBtn, resultEl, wrapEl;

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function stat(label, id) {
        const box = el('div', 'tp-stat');
        box.append(el('span', '', label));
        const value = el('b', '', '0');
        value.id = id;
        box.append(value);
        return [box, value];
    }

    function build() {
        root = el('div', 'tp-screen');
        root.id = 'tenpop';
        root.hidden = true;
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
        root.setAttribute('aria-label', '합 10 지우기');

        const inner = el('div', 'tp-inner');

        const head = el('div', 'tp-head');
        const title = el('div', 'tp-title');
        title.append(el('span', 'tp-kicker', '보너스 게임'), el('strong', '', '합 10 지우기'));
        const closeBtn = el('button', 'tp-close');
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', '보너스 게임 닫기');
        closeBtn.innerHTML = '<i class="fas fa-times"></i>';
        closeBtn.addEventListener('click', close);
        head.append(title, closeBtn);

        const hud = el('div', 'tp-hud');
        [timeBox, timeEl] = stat('시간', 'tp-time');
        timeBox.classList.add('tp-stat-time');
        hud.append(timeBox);
        let box;
        [box, scoreEl] = stat('점수', 'tp-score');
        hud.append(box);
        [box, comboEl] = stat('콤보', 'tp-combo');
        hud.append(box);
        [box, leftEl] = stat('남은 합', 'tp-left');
        hud.append(box);

        const gauge = el('div', 'tp-gauge');
        gaugeEl = el('i');
        gauge.append(gaugeEl);
        gauge.setAttribute('aria-hidden', 'true');

        feverBar = el('div', 'tp-fever');
        feverBar.setAttribute('aria-hidden', 'true');
        feverFill = el('i');
        feverBar.append(feverFill, el('span', '', 'FEVER'));

        wrapEl = el('div', 'tp-board-wrap');
        boardEl = el('div', 'tp-board');
        cells = [];
        for (let i = 0; i < SIZE * SIZE; i++) {
            const cell = el('div', 'tp-cell');
            cell.dataset.i = i;
            boardEl.append(cell);
            cells.push(cell);
        }
        // The path being drawn, as a line through the cell centers.
        const ns = 'http://www.w3.org/2000/svg';
        pathSvg = document.createElementNS(ns, 'svg');
        pathSvg.setAttribute('class', 'tp-path');
        pathSvg.setAttribute('aria-hidden', 'true');
        pathLine = document.createElementNS(ns, 'polyline');
        pathSvg.append(pathLine);
        boardEl.append(pathSvg);
        wrapEl.append(boardEl);

        resultEl = el('div', 'tp-result');
        resultEl.hidden = true;

        hintEl = el('p', 'tp-hint');
        hintEl.setAttribute('aria-live', 'polite');

        const itemBar = el('div', 'tp-items');
        itemBtns = {};
        Object.entries(ITEMS).forEach(([type, info]) => {
            const btn = el('button', 'tp-item');
            btn.type = 'button';
            btn.dataset.item = type;
            btn.setAttribute('aria-label', info.name);
            btn.append(el('span', 'tp-item-icon', info.icon), el('span', 'tp-item-name', info.name), el('b', 'tp-item-count', '0'));
            btn.addEventListener('click', () => toggleItem(type));
            itemBar.append(btn);
            itemBtns[type] = btn;
        });

        const actions = el('div', 'tp-actions');
        shuffleBtn = el('button', 'tp-btn');
        shuffleBtn.type = 'button';
        shuffleBtn.addEventListener('click', shuffle);
        finishBtn = el('button', 'tp-btn tp-btn-ghost', '그만하기');
        finishBtn.type = 'button';
        finishBtn.addEventListener('click', () => finish('quit'));
        actions.append(shuffleBtn, finishBtn);

        inner.append(head, hud, gauge, feverBar, wrapEl, hintEl, itemBar, actions);
        root.append(inner, resultEl);
        document.body.append(root);

        // Mouse / pen use pointer events. Fingers use touch events with preventDefault:
        // phones (iOS Safari above all) otherwise take the move as a scroll and cancel the drag.
        boardEl.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') onDown(e, false); });
        boardEl.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') onMove(e); });
        boardEl.addEventListener('pointerup', (e) => { if (e.pointerType !== 'touch') onUp(); });
        boardEl.addEventListener('pointercancel', (e) => { if (e.pointerType !== 'touch') cancelDrag(); });
        boardEl.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (e.touches.length > 1) return;   // ignore a second finger
            onDown(e.changedTouches[0], true);
        }, { passive: false });
        boardEl.addEventListener('touchmove', (e) => {
            e.preventDefault();
            onMove(e.changedTouches[0]);
        }, { passive: false });
        boardEl.addEventListener('touchend', (e) => {
            e.preventDefault();
            onUp();
        }, { passive: false });
        boardEl.addEventListener('touchcancel', cancelDrag);
        document.addEventListener('keydown', (e) => {
            if (root.hidden || e.key !== 'Escape') return;
            if (itemMode) cancelItem(); else close();
        });
    }

    // === Board helpers ===
    const at = ([r, c]) => grid[r][c];
    const cellEl = ([r, c]) => cells[r * SIZE + c];
    const same = (a, b) => a[0] === b[0] && a[1] === b[1];
    const adjacent = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;
    const inside = (r, c) => r >= 0 && c >= 0 && r < SIZE && c < SIZE;
    const NEIGHBORS = [[0, 1], [1, 0], [0, -1], [-1, 0]];

    function sumInfo(list) {
        let fixed = 0;
        let jokers = 0;
        list.forEach((p) => {
            const v = at(p);
            if (v === JOKER) jokers++; else fixed += v;
        });
        return { fixed, jokers };
    }

    function leftSum() {
        return grid.reduce((sum, row) => sum + row.reduce((a, v) => a + (v > 0 ? v : 0), 0), 0);
    }

    // Is there any unbroken path (2+ cells) that makes 10 or 20?
    function hasMove(g = grid) {
        const seen = new Uint8Array(SIZE * SIZE);
        const walk = (r, c, fixed, jokers, len) => {
            if (reach(fixed, jokers, len)) return true;
            if (fixed + jokers >= MAX_TARGET) return false;
            for (const [dr, dc] of NEIGHBORS) {
                const rr = r + dr;
                const cc = c + dc;
                if (!inside(rr, cc) || !g[rr][cc] || seen[rr * SIZE + cc]) continue;
                const v = g[rr][cc];
                seen[rr * SIZE + cc] = 1;
                const found = walk(rr, cc, fixed + (v === JOKER ? 0 : v), jokers + (v === JOKER ? 1 : 0), len + 1);
                seen[rr * SIZE + cc] = 0;
                if (found) return true;
            }
            return false;
        };
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                const v = g[r][c];
                if (!v) continue;
                seen[r * SIZE + c] = 1;
                const found = walk(r, c, v === JOKER ? 0 : v, v === JOKER ? 1 : 0, 1);
                seen[r * SIZE + c] = 0;
                if (found) return true;
            }
        }
        return false;
    }

    function canAct() {
        return shufflesLeft > 0 || Object.values(items).some((n) => n > 0);
    }

    function lineCells(a, b) {
        const out = [];
        const dr = Math.sign(b[0] - a[0]);
        const dc = Math.sign(b[1] - a[1]);
        const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
        for (let k = 0; k <= n; k++) out.push([a[0] + dr * k, a[1] + dc * k]);
        return out;
    }

    // === Rendering ===
    function cellClass(r, c) {
        const v = grid[r][c];
        if (!v) return 'tp-cell tp-empty';
        if (v === JOKER) return 'tp-cell tp-joker';
        const sp = special[r][c];
        let cls = `tp-cell tp-v${v}`;
        if (sp) cls += ` tp-${sp.type}${sp.type === 'ice' && sp.hp < 2 ? ' tp-ice-cracked' : ''}`;
        return cls;
    }

    function render(drops = null) {
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                const cell = cells[r * SIZE + c];
                const v = grid[r][c];
                cell.textContent = v === JOKER ? '?' : v ? String(v) : '';
                cell.className = cellClass(r, c);
                const drop = drops ? drops[r][c] : 0;
                if (drop > 0) {
                    cell.style.setProperty('--drop', drop);
                    cell.style.setProperty('--fall-ms', `${Math.round(160 + 70 * Math.sqrt(drop))}ms`);
                    void cell.offsetWidth;
                    cell.classList.add('tp-fall');
                }
            }
        }
        scoreEl.textContent = score.toLocaleString();
        leftEl.textContent = String(leftSum());
        comboEl.textContent = combo >= 2 ? `×${combo}` : '-';
        shuffleBtn.innerHTML = `<i class="fas fa-random"></i> 셔플 ${shufflesLeft}`;
        shuffleBtn.disabled = shufflesLeft <= 0 || finished;
        finishBtn.disabled = finished;
        renderItems();
        renderFever();
        renderTime();
        paintSelection();
    }

    function renderItems() {
        Object.entries(itemBtns).forEach(([type, btn]) => {
            btn.querySelector('.tp-item-count').textContent = String(items[type]);
            btn.disabled = finished || (items[type] <= 0 && itemMode !== type);
            btn.classList.toggle('active', itemMode === type);
        });
    }

    function renderTime() {
        const s = Math.max(0, timeLeft) / 1000;
        timeEl.textContent = s >= 10 ? String(Math.ceil(s)) : s.toFixed(1);
        timeBox.classList.toggle('tp-time-low', s < 10 && !finished);
    }

    function renderFever() {
        feverBar.classList.toggle('on', feverOn);
        if (!feverOn) feverFill.style.transform = `scaleX(${fever / FEVER_MAX})`;
    }

    function selection() {
        if (drag && drag.path.length) return drag.path;
        if (anchor) return [anchor];
        return [];
    }

    function drawPath(sel, state) {
        if (sel.length < 2) {
            pathLine.setAttribute('points', '');
            return;
        }
        const w = boardEl.clientWidth;
        const h = boardEl.clientHeight;
        pathSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        const points = sel.map((p) => {
            const cell = cellEl(p);
            return `${cell.offsetLeft + cell.offsetWidth / 2},${cell.offsetTop + cell.offsetHeight / 2}`;
        });
        pathLine.setAttribute('points', points.join(' '));
        pathSvg.dataset.state = state;
    }

    function paintSelection() {
        cells.forEach((cell) => cell.classList.remove('tp-sel', 'tp-sel-ok', 'tp-sel-over', 'tp-anchor'));
        if (itemMode) {
            drawPath([]);
            if (swapFirst) cellEl(swapFirst).classList.add('tp-anchor');
            setHint(`${ITEMS[itemMode].icon} ${swapFirst ? '바꿀 이웃 칸을 누르세요' : ITEMS[itemMode].hint}`, 'item');
            return;
        }
        const sel = selection();
        if (!sel.length) {
            drawPath([]);
            setHint();
            return;
        }
        const { fixed, jokers } = sumInfo(sel);
        const target = reach(fixed, jokers, sel.length);
        const state = target ? 'ok' : fixed + jokers > MAX_TARGET ? 'over' : '';
        sel.forEach((p) => {
            const cell = cellEl(p);
            cell.classList.add('tp-sel');
            if (state) cell.classList.add(`tp-sel-${state}`);
        });
        if (!drag && anchor) cellEl(anchor).classList.add('tp-anchor');
        drawPath(sel, state);

        const shown = target || (jokers ? `${fixed}+?` : fixed);
        if (sel.length === 1) {
            setHint(drag ? `${shown} · 상하좌우로 이어서 그려 보세요` : `${shown} · 같은 줄의 다른 칸을 눌러 이어 보세요`);
            return;
        }
        const expr = sel.length > 6 ? `${sel.length}칸` : sel.map((p) => (at(p) === JOKER ? '?' : at(p))).join(' + ');
        const shape = shapeOf(sel);
        const tags = [];
        if (target === 20) tags.push(`더블 텐 ×${DOUBLE_MULT}`);
        if (target && shape.mult > 1) tags.push(`${shape.name} ×${shape.mult}`);
        const tag = tags.length ? ` · ${tags.join(' · ')}` : '';
        setHint(`${expr} = ${shown}${tag}`, state === 'ok' ? 'ok' : state === 'over' ? 'warn' : '');
    }

    function setHint(text, tone = '') {
        if (text === undefined) {
            if (finished) {
                text = '';
            } else if (feverOn) {
                text = '🔥 FEVER! 점수 2배';
                tone = 'hot';
            } else if (!hasMove()) {
                text = canAct() ? '막혔어요! 셔플이나 아이템을 써 보세요' : '더 지울 수 있는 칸이 없어요';
                tone = 'warn';
            } else {
                text = '이어진 칸을 그려서 합 10 또는 20을 만드세요';
            }
        }
        hintEl.textContent = text;
        hintEl.dataset.tone = tone;
    }

    function banner(text, tier) {
        const node = el('div', `tp-banner tp-banner-${tier}`, text);
        wrapEl.append(node);
        setTimeout(() => node.remove(), 950);
    }

    // === Timer ===
    function tick() {
        const now = performance.now();
        const dt = now - lastTick;
        lastTick = now;
        // The clock stops while a chain is playing out and while the page is in the background.
        if (finished || !root || root.hidden || busy || document.hidden) return;
        timeLeft -= dt;
        playMs += dt;
        if (timeLeft <= 0) {
            timeLeft = 0;
            renderTime();
            finish('time');
            return;
        }
        renderTime();
        const sec = Math.ceil(timeLeft / 1000);
        if (sec <= 5 && sec !== lastBeep) {
            lastBeep = sec;
            fx('onTenTick', { sec });
        }
    }

    function addTime(seconds) {
        if (finished || seconds <= 0) return;
        timeLeft = Math.min(MAX_TIME_MS, timeLeft + seconds * 1000);
        if (timeLeft > 5000) lastBeep = 0;
        renderTime();
        const pop = el('span', 'tp-time-pop', `+${seconds}s`);
        timeBox.append(pop);
        setTimeout(() => pop.remove(), 900);
    }

    // === Input ===
    // strict: only count the inner part of a cell, so cutting a corner doesn't pick a diagonal cell.
    function pointToCell(e, strict) {
        const rect = boardEl.getBoundingClientRect();
        const fx2 = ((e.clientX - rect.left) / rect.width) * SIZE;
        const fy2 = ((e.clientY - rect.top) / rect.height) * SIZE;
        const c = Math.floor(fx2);
        const r = Math.floor(fy2);
        if (!inside(r, c)) return null;
        if (strict) {
            const ix = fx2 - c;
            const iy = fy2 - r;
            if (ix < 0.14 || ix > 0.86 || iy < 0.14 || iy > 0.86) return null;
        }
        return [r, c];
    }

    // e: a PointerEvent, or a Touch (fromTouch). Both carry clientX / clientY.
    function onDown(e, fromTouch) {
        if (busy || finished) return;
        const p = pointToCell(e, false);
        if (!p) return;
        if (!fromTouch) e.preventDefault();
        if (itemMode) {
            useItemOn(p);
            return;
        }
        if (!fromTouch) {
            try { boardEl.setPointerCapture(e.pointerId); } catch (err) { /* not supported */ }
        }
        drag = { path: at(p) ? [p] : [], start: p, moved: false };
        lastStepKey = '';
        paintSelection();
    }

    function onMove(e) {
        if (!drag || !drag.path.length) return;
        const p = pointToCell(e, true);
        if (!p) return;
        const path = drag.path;
        const last = path[path.length - 1];
        if (same(p, last)) return;

        const index = path.findIndex((q) => same(q, p));
        if (index >= 0) {
            // Back over the path: undo back to that cell.
            drag.path = path.slice(0, index + 1);
        } else if (adjacent(p, last)) {
            if (!at(p)) return;
            path.push(p);
        } else if (p[0] === last[0] || p[1] === last[1]) {
            // A quick swipe skipped cells on a straight line: fill them in if they're usable.
            const fill = lineCells(last, p).slice(1);
            if (fill.some((q) => !at(q) || path.some((s) => same(s, q)))) return;
            path.push(...fill);
        } else {
            return;
        }
        if (drag.path.length > 1) {
            drag.moved = true;
            anchor = null;
        }
        paintSelection();
        stepSound();
    }

    function stepSound() {
        const sel = drag ? drag.path : [];
        const key = sel.map((p) => p.join(',')).join('|');
        if (key === lastStepKey || sel.length < 2) return;
        lastStepKey = key;
        const { fixed, jokers } = sumInfo(sel);
        const target = reach(fixed, jokers, sel.length);
        fx('onTenStep', { len: sel.length, sum: target || (fixed + jokers > MAX_TARGET ? 99 : fixed) });
    }

    function onUp() {
        if (!drag) return;
        const current = drag;
        drag = null;
        if (current.moved && current.path.length > 1) {
            tryClear(current.path);
            return;
        }
        // A tap: the first tap picks one end, a tap on the same row/column picks the other end.
        const p = current.start;
        if (!at(p)) {
            anchor = null;
        } else if (!anchor) {
            anchor = p;
            fx('onTenPick');
        } else if (same(anchor, p)) {
            anchor = null;
        } else if (anchor[0] === p[0] || anchor[1] === p[1]) {
            const line = lineCells(anchor, p);
            anchor = null;
            tryClear(line);
            return;
        } else {
            anchor = p;
            fx('onTenPick');
        }
        paintSelection();
    }

    function cancelDrag() {
        drag = null;
        paintSelection();
    }

    // === Moves ===
    function tryClear(path) {
        const { fixed, jokers } = sumInfo(path);
        const target = reach(fixed, jokers, path.length);
        if (path.every((p) => at(p)) && target) {
            clearPath(path, target);
        } else {
            miss(path);
        }
    }

    function miss(path) {
        // A wrong try ends the combo, so speed doesn't turn into random dragging.
        breakCombo();
        path.forEach((p) => {
            const cell = cellEl(p);
            cell.classList.remove('tp-shake');
            void cell.offsetWidth;
            cell.classList.add('tp-shake');
            setTimeout(() => cell.classList.remove('tp-shake'), 320);
        });
        fx('onTenMiss');
        render();
    }

    function breakCombo() {
        combo = 0;
        clearTimeout(comboTimer);
        gaugeEl.parentElement.classList.remove('active');
    }

    // Combo gauge drains over the window; when it runs out the combo is over.
    function restartComboWindow() {
        lastClearAt = performance.now();
        const gauge = gaugeEl.parentElement;
        gauge.classList.remove('active');
        void gauge.offsetWidth;
        gauge.classList.add('active');
        clearTimeout(comboTimer);
        comboTimer = setTimeout(() => {
            combo = 0;
            gauge.classList.remove('active');
            if (!finished) comboEl.textContent = '-';
        }, COMBO_WINDOW_MS);
    }

    // Works out what a clear takes: ice only cracks on its first hit, bombs take their
    // four neighbours with them (and set off other bombs).
    function resolveClear(list) {
        const key = ([r, c]) => r * SIZE + c;
        const removed = new Map();
        const cracked = [];
        const extra = [];
        let stars = 0;
        let bombs = 0;
        const hit = (p, fromBomb) => {
            const k = key(p);
            if (removed.has(k) || cracked.some((q) => same(q, p))) return;
            const sp = special[p[0]][p[1]];
            if (sp && sp.type === 'ice' && sp.hp > 1) {
                cracked.push(p);
                return;
            }
            removed.set(k, p);
            if (fromBomb) extra.push(p);
            if (sp && sp.type === 'star') stars++;
            if (sp && sp.type === 'bomb') {
                bombs++;
                for (const [dr, dc] of NEIGHBORS) {
                    const q = [p[0] + dr, p[1] + dc];
                    if (!inside(q[0], q[1]) || !at(q)) continue;
                    hit(q, true);
                }
            }
        };
        list.forEach((p) => hit(p, false));
        return { removed: [...removed.values()], cracked, extra, stars, bombs };
    }

    function animateClear(result) {
        result.removed.forEach((p) => cellEl(p).classList.add('tp-pop'));
        result.cracked.forEach((p) => cellEl(p).classList.add('tp-crack'));
        if (result.bombs) {
            fx('onTenBomb', { cells: result.extra.map(cellEl) });
            banner('💣 BOOM!', 2);
            addTime(1);
        }
    }

    // Removes the cells, cracks the ice, lets everything fall. Returns how far each cell fell.
    function applyClear(result) {
        result.removed.forEach(([r, c]) => {
            grid[r][c] = 0;
            special[r][c] = null;
        });
        result.cracked.forEach(([r, c]) => {
            if (special[r][c]) special[r][c].hp = 1;
        });
        cleared += result.removed.length;
        return applyGravity();
    }

    // Pop what the result takes, let it fall, then let chains play out.
    function popThenChain(result) {
        const id = gameId;
        setTimeout(() => {
            if (id !== gameId) return;
            const drops = applyClear(result);
            render(drops);
            setTimeout(() => runChain(drops, 1, id), CHAIN_WAIT_MS);
        }, POP_MS);
    }

    function clearPath(path, target) {
        busy = true;
        const now = performance.now();
        combo = now - lastClearAt <= COMBO_WINDOW_MS ? combo + 1 : 1;
        maxCombo = Math.max(maxCombo, combo);
        const shape = shapeOf(path);
        const result = resolveClear(path);
        const feverMult = feverOn ? 2 : 1;
        const isDouble = target === 20;
        const points = Math.round(basePoints(path.length) * shape.mult * comboMultiplier(combo) *
            (isDouble ? DOUBLE_MULT : 1) *
            (result.stars ? 2 : 1) * feverMult) + result.extra.length * 15 * feverMult;
        score += points;

        animateClear(result);
        fx('onTenClear', { cells: path.map(cellEl), combo, points, length: path.length, star: result.stars > 0, fever: feverOn });
        if (result.stars) banner('★ 점수 2배!', 2);
        else if (isDouble) banner('더블 텐!', 2);
        else if (combo >= 3 && combo % 5 === 0) banner(`${combo} COMBO!`, combo >= 10 ? 3 : 2);
        else if (combo === 3) banner('3 COMBO!', 1);
        else if (shape.name === '일자' && path.length >= 4) banner(`일자 ${path.length}칸!`, 2);
        else if (path.length >= 6) banner(`${path.length}칸 뱀!`, 2);

        // Time: 1s per clear, more for straight lines, double tens and long paths.
        addTime(1 + (shape.name === '일자' ? 1 : 0) + (isDouble ? 1 : 0) + (path.length >= 5 ? 1 : 0));
        // A random item every 4th combo.
        if (combo >= 4 && combo % 4 === 0) giveItem();
        addFever(6 + 3 * Math.min(combo, 6) + 4 * (path.length - 2) + (shape.name === '일자' ? 6 : 0));
        restartComboWindow();
        popThenChain(result);
    }

    // After a fall: pairs that have just come together and make 10 pop by themselves.
    function findChainPairs(drops) {
        const taken = new Set();
        const pairs = [];
        for (let r = SIZE - 1; r >= 0; r--) {
            for (let c = 0; c < SIZE; c++) {
                if (grid[r][c] <= 0 || taken.has(r * SIZE + c)) continue;
                for (const [dr, dc] of [[0, 1], [-1, 0]]) {
                    const rr = r + dr;
                    const cc = c + dc;
                    if (!inside(rr, cc) || grid[rr][cc] <= 0 || taken.has(rr * SIZE + cc)) continue;
                    if (grid[r][c] + grid[rr][cc] !== 10) continue;
                    // Only pairs that just met: two cells that fell the same distance were already touching.
                    if (drops[r][c] === drops[rr][cc]) continue;
                    taken.add(r * SIZE + c);
                    taken.add(rr * SIZE + cc);
                    pairs.push([[r, c], [rr, cc]]);
                    break;
                }
            }
        }
        return pairs;
    }

    function runChain(drops, step, id) {
        if (finished || id !== gameId) return;
        const pairs = step <= 12 ? findChainPairs(drops) : [];
        if (!pairs.length) {
            busy = false;
            restartComboWindow();
            paintSelection();
            checkStuck();
            return;
        }
        maxChain = Math.max(maxChain, step);
        const result = resolveClear(pairs.flat());
        const feverMult = feverOn ? 2 : 1;
        const points = (30 * step * pairs.length + result.extra.length * 15) * (result.stars ? 2 : 1) * feverMult;
        score += points;
        animateClear(result);
        fx('onTenChain', { cells: pairs.flat().map(cellEl), step, points });
        banner(step === 1 ? '연쇄!' : `${step}연쇄!`, step >= 3 ? 3 : 2);
        addTime(1);
        addFever(Math.min(12, 4 * pairs.length));

        setTimeout(() => {
            if (id !== gameId) return;
            const next = applyClear(result);
            render(next);
            setTimeout(() => runChain(next, step + 1, id), CHAIN_WAIT_MS);
        }, POP_MS);
    }

    // Numbers (and their special marks) fall straight down into the gaps.
    function applyGravity() {
        const drops = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
        for (let c = 0; c < SIZE; c++) {
            let write = SIZE - 1;
            const column = [];
            for (let r = SIZE - 1; r >= 0; r--) {
                if (grid[r][c]) column.push([r, grid[r][c], special[r][c]]);
            }
            for (let r = 0; r < SIZE; r++) {
                grid[r][c] = 0;
                special[r][c] = null;
            }
            for (const [from, v, sp] of column) {
                grid[write][c] = v;
                special[write][c] = sp;
                drops[write][c] = write - from;
                write--;
            }
        }
        return drops;
    }

    // === Items ===
    function giveItem(type) {
        const pool = Object.keys(ITEMS).filter((t) => items[t] < ITEM_MAX);
        if (!pool.length) return;
        const pick = type && pool.includes(type) ? type : pool[Math.floor(Math.random() * pool.length)];
        items[pick]++;
        renderItems();
        const btn = itemBtns[pick];
        btn.classList.remove('tp-item-new');
        void btn.offsetWidth;
        btn.classList.add('tp-item-new');
        setTimeout(() => btn.classList.remove('tp-item-new'), 900);
        fx('onTenItemGet');
    }

    function toggleItem(type) {
        if (finished || busy) return;
        if (itemMode === type) {
            cancelItem();
            return;
        }
        if (items[type] <= 0) return;
        itemMode = type;
        swapFirst = null;
        anchor = null;
        drag = null;
        renderItems();
        paintSelection();
    }

    function cancelItem() {
        itemMode = null;
        swapFirst = null;
        renderItems();
        paintSelection();
    }

    function useItemOn(p) {
        if (!at(p)) return;
        if (itemMode === 'hammer') {
            useHammer(p);
        } else if (itemMode === 'joker') {
            if (at(p) === JOKER) return;
            useJoker(p);
        } else if (itemMode === 'swap') {
            if (!swapFirst || same(swapFirst, p)) {
                swapFirst = swapFirst ? null : p;
                if (swapFirst) fx('onTenPick');
                paintSelection();
            } else if (adjacent(swapFirst, p)) {
                useSwap(swapFirst, p);
            } else {
                swapFirst = p;
                fx('onTenPick');
                paintSelection();
            }
        }
    }

    function useHammer(p) {
        items.hammer--;
        itemMode = null;
        busy = true;
        const result = resolveClear([p]);
        animateClear(result);
        fx('onTenItem', { type: 'hammer', cell: cellEl(p) });
        score += result.extra.length * 15 * (feverOn ? 2 : 1);
        renderItems();
        const id = gameId;
        setTimeout(() => {
            if (id !== gameId) return;
            const drops = applyClear(result);
            render(drops);
            setTimeout(() => afterItem(drops, id, '🔨 자동 폭발!'), CHAIN_WAIT_MS);
        }, POP_MS);
    }

    function useSwap(a, b) {
        items.swap--;
        itemMode = null;
        swapFirst = null;
        busy = true;
        [grid[a[0]][a[1]], grid[b[0]][b[1]]] = [grid[b[0]][b[1]], grid[a[0]][a[1]]];
        [special[a[0]][a[1]], special[b[0]][b[1]]] = [special[b[0]][b[1]], special[a[0]][a[1]]];
        render();
        [a, b].forEach((p) => {
            const cell = cellEl(p);
            cell.classList.add('tp-swapped');
            setTimeout(() => cell.classList.remove('tp-swapped'), 400);
        });
        fx('onTenItem', { type: 'swap', cell: cellEl(b) });
        const moved = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
        moved[a[0]][a[1]] = 1;
        moved[b[0]][b[1]] = 1;
        const id = gameId;
        setTimeout(() => afterItem(moved, id, '🔄 바꾸기 성공!'), CHAIN_WAIT_MS);
    }

    function useJoker(p) {
        items.joker--;
        itemMode = null;
        grid[p[0]][p[1]] = JOKER;
        special[p[0]][p[1]] = null;
        fx('onTenItem', { type: 'joker', cell: cellEl(p) });
        render();
        const cell = cellEl(p);
        cell.classList.add('tp-swapped');
        setTimeout(() => cell.classList.remove('tp-swapped'), 400);
        checkStuck();
    }

    // After a hammer or a swap: the best straight run through the cells that moved, adding up
    // to exactly 10 or 20, pops at once (only one, so a single item doesn't wipe the board;
    // chains can still follow). A run must mix moved and unmoved cells (or cells that moved
    // by different amounts), so a run that was already there before doesn't count.
    function findItemRuns(moved) {
        const runs = new Map();
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                if (!moved[r][c] || grid[r][c] <= 0) continue;
                let best = null;
                for (const [dr, dc] of [[0, 1], [1, 0]]) {
                    // The unbroken line of numbers (no jokers) through (r, c) on this axis.
                    const line = [[r, c]];
                    for (let k = 1; inside(r - dr * k, c - dc * k) && grid[r - dr * k][c - dc * k] > 0; k++) line.unshift([r - dr * k, c - dc * k]);
                    for (let k = 1; inside(r + dr * k, c + dc * k) && grid[r + dr * k][c + dc * k] > 0; k++) line.push([r + dr * k, c + dc * k]);
                    const idx = line.findIndex((p) => p[0] === r && p[1] === c);
                    for (let i = 0; i <= idx; i++) {
                        let sum = 0;
                        for (let j = i; j < line.length; j++) {
                            sum += at(line[j]);
                            if (sum > MAX_TARGET) break;
                            if (j < idx || j === i || (sum !== 10 && sum !== 20)) continue;
                            const run = line.slice(i, j + 1);
                            if (new Set(run.map(([rr, cc]) => moved[rr][cc])).size < 2) continue;
                            const better = !best || sum > best.sum || (sum === best.sum && run.length > best.run.length);
                            if (better) best = { run, sum };
                        }
                    }
                }
                if (best) runs.set(best.run.map((p) => p.join(',')).join('|'), best);
            }
        }
        const all = [...runs.values()].sort((a, b) => b.sum - a.sum || b.run.length - a.run.length);
        return all.slice(0, 1);
    }

    function afterItem(moved, id, label) {
        if (finished || id !== gameId) return;
        const runs = findItemRuns(moved);
        if (!runs.length) {
            busy = false;
            paintSelection();
            checkStuck();
            return;
        }
        const union = [];
        runs.forEach(({ run }) => run.forEach((p) => { if (!union.some((q) => same(q, p))) union.push(p); }));
        const result = resolveClear(union);
        const feverMult = feverOn ? 2 : 1;
        let points = 0;
        runs.forEach(({ run, sum }) => {
            points += basePoints(run.length) * (run.length >= 3 ? 1.5 : 1) * (sum === 20 ? DOUBLE_MULT : 1);
        });
        points = Math.round(points * (result.stars ? 2 : 1) * feverMult) + result.extra.length * 15 * feverMult;
        score += points;
        animateClear(result);
        fx('onTenChain', { cells: union.map(cellEl), step: 2, points });
        banner(label, 3);
        addTime(1 + runs.length);
        addFever(12);
        popThenChain(result);
    }

    // === Fever ===
    function addFever(amount) {
        if (feverOn || finished) return;
        fever = Math.min(FEVER_MAX, fever + amount);
        if (fever >= FEVER_MAX) startFever();
        renderFever();
    }

    function startFever() {
        feverOn = true;
        root.classList.add('tp-fever-on');
        feverFill.style.transform = '';
        feverBar.classList.remove('on');
        void feverBar.offsetWidth;
        feverBar.classList.add('on');
        banner('🔥 FEVER!', 3);
        fx('onTenFever', { on: true });
        giveItem();
        clearTimeout(feverTimer);
        feverTimer = setTimeout(endFever, FEVER_MS);
        if (!drag && !itemMode) setHint();
    }

    function endFever() {
        clearTimeout(feverTimer);
        if (!feverOn) return;
        feverOn = false;
        fever = 0;
        root.classList.remove('tp-fever-on');
        renderFever();
        fx('onTenFever', { on: false });
        if (!drag) paintSelection();
    }

    // === Shuffle ===
    function shuffle() {
        if (finished || busy || shufflesLeft <= 0) return;
        if (itemMode) cancelItem();
        const spots = [];
        const pieces = [];
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                if (grid[r][c]) {
                    spots.push([r, c]);
                    pieces.push([grid[r][c], special[r][c]]);
                }
            }
        }
        if (pieces.length < 2) return;
        // Keep the shape, mix the numbers (special marks go with their number).
        let order = pieces;
        for (let attempt = 0; attempt < 80; attempt++) {
            order = pieces.slice();
            for (let i = order.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [order[i], order[j]] = [order[j], order[i]];
            }
            const trial = grid.map((row) => row.slice());
            spots.forEach(([r, c], i) => { trial[r][c] = order[i][0]; });
            if (hasMove(trial)) break;
        }
        spots.forEach(([r, c], i) => {
            grid[r][c] = order[i][0];
            special[r][c] = order[i][1];
        });
        shufflesLeft--;
        anchor = null;
        breakCombo();
        shuffleBtn.classList.remove('tp-attn');
        fx('onTenShuffle');
        render();
        cells.forEach((cell) => {
            if (cell.classList.contains('tp-empty')) return;
            cell.classList.add('tp-mix');
            setTimeout(() => cell.classList.remove('tp-mix'), 420);
        });
        checkStuck();
    }

    function checkStuck() {
        if (finished || hasMove()) return;
        if (canAct()) {
            if (shufflesLeft > 0) shuffleBtn.classList.add('tp-attn');
            setHint();
            return;
        }
        setTimeout(() => finish('stuck'), 650);
    }

    // === Result ===
    function formatTime(ms) {
        const s = Math.round(ms / 1000);
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    function finish(reason = 'stuck') {
        if (finished) return;
        finished = true;
        anchor = null;
        drag = null;
        itemMode = null;
        swapFirst = null;
        breakCombo();
        endFever();
        shuffleBtn.classList.remove('tp-attn');
        const left = leftSum();
        const allClear = left === 0;
        const perfect = !allClear && left <= 5;

        const best = loadBest();
        const newScore = score > (best.score || 0);
        const newLeft = best.left === null || best.left === undefined || left < best.left;
        const isFirst = !best.plays;
        best.plays = (best.plays || 0) + 1;
        if (newScore) best.score = score;
        if (newLeft) best.left = left;
        best.combo = Math.max(best.combo || 0, maxCombo);
        best.chain = Math.max(best.chain || 0, maxChain);
        saveBest(best);

        render();
        resultEl.replaceChildren();
        const card = el('div', 'tp-result-card');
        const kicker = allClear || perfect ? '최고의 마무리' : reason === 'time' ? '⏱ 시간 종료' : '보너스 결과';
        card.append(el('span', 'tp-kicker', kicker));
        card.append(el('strong', 'tp-result-score', score.toLocaleString()));
        card.append(el('span', 'tp-result-unit', '점'));

        const record = newScore && !isFirst;
        if (allClear || perfect || record) {
            const stamps = el('div', 'tp-stamps');
            if (allClear) stamps.append(el('span', 'tp-stamp tp-stamp-perfect', 'ALL CLEAR'));
            if (perfect) stamps.append(el('span', 'tp-stamp tp-stamp-perfect', 'PERFECT'));
            if (record) stamps.append(el('span', 'tp-stamp tp-stamp-record', 'NEW RECORD'));
            card.append(stamps);
        }

        const rows = el('div', 'tp-result-rows');
        const row = (label, value, note = '') => {
            const line = el('div', 'tp-result-row');
            line.append(el('span', '', label), el('b', '', value));
            if (note) line.append(el('em', '', note));
            rows.append(line);
        };
        row('지운 칸 · 플레이 시간', `${cleared} / 81 · ${formatTime(playMs)}`);
        row('최고 콤보 · 연쇄', `${maxCombo >= 2 ? `×${maxCombo}` : '-'} · ${maxChain ? maxChain : '-'}`);
        row('남은 합', String(left), allClear ? '모두 비움' : `최소 기록 ${best.left}`);
        row('최고 점수', best.score.toLocaleString(), newScore ? '새 기록' : '');
        card.append(rows);

        const buttons = el('div', 'tp-result-actions');
        const again = el('button', 'primary-btn', '다시 하기');
        again.type = 'button';
        again.addEventListener('click', () => start(startGrid));
        const back = el('button', 'tp-btn tp-btn-ghost', '결과로 돌아가기');
        back.type = 'button';
        back.addEventListener('click', close);
        buttons.append(again, back);
        card.append(buttons);
        resultEl.append(card);
        resultEl.hidden = false;
        requestAnimationFrame(() => resultEl.classList.add('active'));
        if (cleared > 0) fx('onTenEnd', { perfect: allClear || perfect, record });
    }

    // === Open / close ===
    function placeSpecials() {
        special = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
        const spots = Array.from({ length: SIZE * SIZE }, (_, i) => i);
        for (let i = spots.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [spots[i], spots[j]] = [spots[j], spots[i]];
        }
        let k = 0;
        Object.entries(SPECIALS).forEach(([type, count]) => {
            for (let n = 0; n < count; n++) {
                const i = spots[k++];
                special[Math.floor(i / SIZE)][i % SIZE] = { type, hp: type === 'ice' ? 2 : 1 };
            }
        });
    }

    function start(solved) {
        gameId++;
        startGrid = solved.map((row) => row.slice());
        grid = startGrid.map((row) => row.slice());
        placeSpecials();
        score = 0;
        combo = 0;
        maxCombo = 0;
        maxChain = 0;
        cleared = 0;
        lastClearAt = 0;
        shufflesLeft = 1;
        items = { hammer: 1, swap: 1, joker: 0 };
        itemMode = null;
        swapFirst = null;
        timeLeft = START_TIME_MS;
        playMs = 0;
        lastBeep = 0;
        busy = false;
        finished = false;
        anchor = null;
        drag = null;
        breakCombo();
        clearTimeout(feverTimer);
        feverOn = false;
        fever = 0;
        root.classList.remove('tp-fever-on');
        feverBar.classList.remove('on');
        shuffleBtn.classList.remove('tp-attn');
        resultEl.hidden = true;
        resultEl.classList.remove('active');
        render();
        clearInterval(timerId);
        lastTick = performance.now();
        timerId = setInterval(tick, 100);
    }

    function open(solved) {
        const valid = Array.isArray(solved) && solved.length === SIZE &&
            solved.every((row) => Array.isArray(row) && row.length === SIZE && row.every((v) => v >= 1 && v <= 9));
        if (!valid) return false;
        if (!root) build();
        root.hidden = false;
        start(solved);
        document.body.classList.add('tp-open');
        requestAnimationFrame(() => root.classList.add('active'));
        return true;
    }

    function close() {
        if (!root) return;
        clearTimeout(comboTimer);
        clearTimeout(feverTimer);
        clearInterval(timerId);
        feverOn = false;
        gameId++;
        root.classList.remove('active', 'tp-fever-on');
        document.body.classList.remove('tp-open');
        setTimeout(() => { if (!root.classList.contains('active')) root.hidden = true; }, 200);
    }

    window.TenPop = { open, close, isOpen: () => Boolean(root && !root.hidden) };
})();
