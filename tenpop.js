// 합 10 지우기: a bonus game played on the board you just solved.
// Swap two neighbouring numbers. If the swap lines up, in a straight row or column through a
// swapped cell, two touching numbers that make 10 (3·7) or three that make 10 or 20
// (2·3·5, 9·8·3), they pop. Otherwise the swap slides back. Numbers above fall down;
// nothing new comes in, so the board slowly empties.
//
// Extras:
// - Time survival: 60 seconds to start; every match buys a little more time.
// - Chain: after a fall, new pairs making 10 that formed on their own pop too, again and again.
// - Fever: quick matches fill the fever gauge; when it is full, points are doubled for 10 seconds.
// - Special cells: ★ doubles that match, 💣 also blows up its four neighbours, 🧊 needs two hits.
// - Items (won by combos and fever): 🔨 breaks one cell, 🌈 pops every copy of a number,
//   🃏 turns a cell into a joker that counts as whatever number makes the match.
// - Stuck boards are shuffled automatically; standing still for a while shows a hint.
(() => {
    const SIZE = 9;
    const COMBO_WINDOW_MS = 2500;
    const SWAP_MS = 160;
    const POP_MS = 180;
    const CHAIN_WAIT_MS = 260;      // after the fall, before a chain pops
    const HINT_MS = 3500;
    const FEVER_MS = 10000;
    const FEVER_MAX = 100;
    const SPECIALS = { star: 3, bomb: 2, ice: 2 };
    const BEST_KEY = 'sudoku-tenpop-best';
    const START_TIME_MS = 60000;
    const MAX_TIME_MS = 99000;
    const JOKER = -1;               // grid value of a joker cell
    const ITEM_MAX = 3;
    const ITEMS = {
        hammer: { icon: '🔨', name: '망치', hint: '깰 칸을 누르세요' },
        rainbow: { icon: '🌈', name: '무지개', hint: '누른 숫자와 같은 숫자를 모두 터뜨립니다' },
        joker: { icon: '🃏', name: '조커', hint: '조커로 바꿀 칸을 누르세요 (아무 숫자로 쓰임)' }
    };
    const AXES = [[0, 1], [1, 0]];
    const NEIGHBORS = [[0, 1], [1, 0], [0, -1], [-1, 0]];

    // Can these values (JOKER = any 1-9) make a match? Two cells: 10. Three cells: 20 or 10.
    // Returns the sum made, or 0.
    function matchSum(values) {
        let fixed = 0;
        let jokers = 0;
        values.forEach((v) => { if (v === JOKER) jokers++; else fixed += v; });
        const targets = values.length === 2 ? [10] : [20, 10];
        for (const t of targets) {
            if (fixed + jokers <= t && t <= fixed + 9 * jokers) return t;
        }
        return 0;
    }

    // Points for one matched line.
    function linePoints(len, sum) {
        if (len === 2) return 20;
        return sum === 20 ? 80 : 50;
    }

    function comboMultiplier(combo) {
        return Math.min(3, 1 + 0.25 * (combo - 1));
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
    let special = [];       // null | { type: 'star' | 'bomb' | 'ice' | 'joker', hp, v (a joker's old number) }
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
    let items = { hammer: 1, rainbow: 0, joker: 1 };
    let itemMode = null;    // 'hammer' | 'rainbow' | 'joker' while an item is being used
    let timeLeft = START_TIME_MS;
    let playMs = 0;
    let timerId = null;
    let lastTick = 0;
    let lastBeep = 0;
    let idleSince = 0;
    let hintShown = false;
    let busy = false;
    let finished = false;
    let picked = null;      // [r, c] chosen by a tap, waiting for a neighbour
    let press = null;       // { cell, x, y } while a finger / mouse is down
    let gameId = 0;         // timers from an earlier game (closed or restarted mid-chain) stop themselves

    // === DOM (built once, on first open) ===
    let root, boardEl, cells, timeEl, timeBox, scoreEl, comboEl, leftEl, gaugeEl,
        feverBar, feverFill, hintEl, itemBtns, finishBtn, resultEl, wrapEl;

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

        const actions = el('div', 'tp-actions tp-actions-single');
        finishBtn = el('button', 'tp-btn tp-btn-ghost', '그만하기');
        finishBtn.type = 'button';
        finishBtn.addEventListener('click', () => finish('quit'));
        actions.append(finishBtn);

        inner.append(head, hud, gauge, feverBar, wrapEl, hintEl, itemBar, actions);
        root.append(inner, resultEl);
        document.body.append(root);

        // Mouse / pen use pointer events. Fingers use touch events with preventDefault:
        // phones (iOS Safari above all) otherwise take the move as a scroll and cancel it.
        boardEl.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') onDown(e, false); });
        boardEl.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') onMove(e); });
        boardEl.addEventListener('pointerup', (e) => { if (e.pointerType !== 'touch') onUp(); });
        boardEl.addEventListener('pointercancel', (e) => { if (e.pointerType !== 'touch') press = null; });
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
        boardEl.addEventListener('touchcancel', () => { press = null; });
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
    const keyOf = ([r, c]) => r * SIZE + c;

    // A joker still counts its original number, so turning the last numbers into jokers
    // isn't a shortcut to ALL CLEAR.
    function leftSum() {
        let sum = 0;
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                const v = grid[r][c];
                if (v > 0) sum += v;
                else if (v === JOKER) sum += (special[r][c] && special[r][c].v) || 0;
            }
        }
        return sum;
    }

    // The best line (2 or 3 touching cells on one axis) through p that makes a match.
    // skip(line) rules out lines that aren't new.
    function bestLineThrough(g, p, skip, lengths = [3, 2]) {
        let best = null;
        for (const [dr, dc] of AXES) {
            for (const len of lengths) {
                for (let s = 0; s < len; s++) {
                    const line = [];
                    for (let k = 0; k < len; k++) {
                        const r = p[0] + (k - s) * dr;
                        const c = p[1] + (k - s) * dc;
                        if (!inside(r, c) || !g[r][c]) break;
                        line.push([r, c]);
                    }
                    if (line.length !== len || skip(line)) continue;
                    const sum = matchSum(line.map(([r, c]) => g[r][c]));
                    if (!sum) continue;
                    const rank = len * 100 + sum;
                    if (!best || rank > best.rank) best = { line, sum, rank };
                }
            }
        }
        return best;
    }

    // Matches made by swapping a and b in g (g already swapped). A line holding both swapped
    // cells has the same numbers as before the swap, so it doesn't count.
    function swapMatches(g, a, b) {
        const skip = (line) => line.some((q) => same(q, a)) && line.some((q) => same(q, b));
        const found = [];
        [a, b].forEach((p) => {
            for (const axis of AXES) {
                const best = bestLineThrough(g, p, (line) => skip(line) || !onAxis(line, axis));
                if (best && !found.some((f) => sameLine(f.line, best.line))) found.push(best);
            }
        });
        return found;
    }

    function onAxis(line, [dr, dc]) {
        return line.length < 2 || (line[1][0] - line[0][0] === dr && line[1][1] - line[0][1] === dc);
    }

    function sameLine(x, y) {
        return x.length === y.length && x.every((p, i) => same(p, y[i]));
    }

    // Any swap on the board that would make a match? Returns [a, b] or null.
    function findSwap(g = grid) {
        for (let r = SIZE - 1; r >= 0; r--) {
            for (let c = 0; c < SIZE; c++) {
                if (!g[r][c]) continue;
                for (const [dr, dc] of [[0, 1], [-1, 0]]) {
                    const rr = r + dr;
                    const cc = c + dc;
                    if (!inside(rr, cc) || !g[rr][cc] || g[rr][cc] === g[r][c]) continue;
                    [g[r][c], g[rr][cc]] = [g[rr][cc], g[r][c]];
                    const found = swapMatches(g, [r, c], [rr, cc]).length > 0;
                    [g[r][c], g[rr][cc]] = [g[rr][cc], g[r][c]];
                    if (found) return [[r, c], [rr, cc]];
                }
            }
        }
        return null;
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
        if (picked && at(picked)) cellEl(picked).classList.add('tp-anchor');
        scoreEl.textContent = score.toLocaleString();
        leftEl.textContent = String(leftSum());
        comboEl.textContent = combo >= 2 ? `×${combo}` : '-';
        finishBtn.disabled = finished;
        renderItems();
        renderFever();
        renderTime();
        setHint();
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

    function setHint(text, tone = '') {
        if (text === undefined) {
            if (finished) {
                text = '';
            } else if (itemMode) {
                text = `${ITEMS[itemMode].icon} ${ITEMS[itemMode].hint}`;
                tone = 'item';
            } else if (feverOn) {
                text = '🔥 FEVER! 점수 2배';
                tone = 'hot';
            } else {
                text = '이웃한 두 칸을 바꿔서 3·7처럼 합 10을 붙이세요 (세 칸이면 10·20)';
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

    // === Timer (also runs the idle hint) ===
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
        if (!hintShown && !press && !itemMode && now - idleSince > HINT_MS) showHint();
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

    function showHint() {
        const swap = findSwap();
        if (!swap) return;
        hintShown = true;
        swap.forEach((p) => cellEl(p).classList.add('tp-hinting'));
    }

    function clearHint() {
        idleSince = performance.now();
        if (!hintShown) return;
        hintShown = false;
        cells.forEach((cell) => cell.classList.remove('tp-hinting'));
    }

    // === Input ===
    function pointToCell(e) {
        const rect = boardEl.getBoundingClientRect();
        const c = Math.floor(((e.clientX - rect.left) / rect.width) * SIZE);
        const r = Math.floor(((e.clientY - rect.top) / rect.height) * SIZE);
        return inside(r, c) ? [r, c] : null;
    }

    // e: a PointerEvent, or a Touch (fromTouch). Both carry clientX / clientY.
    function onDown(e, fromTouch) {
        clearHint();
        if (busy || finished) return;
        const p = pointToCell(e);
        if (!p) return;
        if (!fromTouch) {
            e.preventDefault();
            try { boardEl.setPointerCapture(e.pointerId); } catch (err) { /* not supported */ }
        }
        if (itemMode) {
            useItemOn(p);
            return;
        }
        if (!at(p)) {
            setPicked(null);
            return;
        }
        // A tap next to the picked cell swaps them; otherwise this cell becomes the picked one.
        if (picked && adjacent(picked, p)) {
            const from = picked;
            setPicked(null);
            trySwap(from, p);
            return;
        }
        press = { cell: p, x: e.clientX, y: e.clientY };
        setPicked(picked && same(picked, p) ? p : p);
    }

    // Dragging a cell toward a neighbour swaps it with that neighbour.
    function onMove(e) {
        if (!press || busy) return;
        const rect = boardEl.getBoundingClientRect();
        const step = rect.width / SIZE;
        const dx = (e.clientX - press.x) / step;
        const dy = (e.clientY - press.y) / step;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 0.4) return;
        const [r, c] = press.cell;
        const to = Math.abs(dx) > Math.abs(dy) ? [r, c + Math.sign(dx)] : [r + Math.sign(dy), c];
        press = null;
        if (!inside(to[0], to[1]) || !at(to)) return;
        setPicked(null);
        trySwap([r, c], to);
    }

    function onUp() {
        press = null;
    }

    function setPicked(p) {
        if (picked) cellEl(picked).classList.remove('tp-anchor');
        picked = p;
        if (picked) {
            cellEl(picked).classList.add('tp-anchor');
            fx('onTenPick');
        }
    }

    // === Swapping ===
    function swapCells(a, b) {
        [grid[a[0]][a[1]], grid[b[0]][b[1]]] = [grid[b[0]][b[1]], grid[a[0]][a[1]]];
        [special[a[0]][a[1]], special[b[0]][b[1]]] = [special[b[0]][b[1]], special[a[0]][a[1]]];
    }

    // Slide animation: each cell starts where the other one was and glides into place.
    function animateSwap(a, b) {
        [[a, b], [b, a]].forEach(([p, from]) => {
            const cell = cellEl(p);
            cell.style.setProperty('--sx', from[1] - p[1]);
            cell.style.setProperty('--sy', from[0] - p[0]);
            cell.classList.remove('tp-slide');
            void cell.offsetWidth;
            cell.classList.add('tp-slide');
        });
    }

    function trySwap(a, b) {
        if (busy || finished) return;
        busy = true;
        swapCells(a, b);
        render();
        animateSwap(a, b);
        fx('onTenSwap');
        const matches = swapMatches(grid, a, b);
        const id = gameId;
        setTimeout(() => {
            if (id !== gameId) return;
            if (matches.length) {
                scoreMatch(matches);
                return;
            }
            // No match: slide back, and the combo is over.
            swapCells(a, b);
            render();
            animateSwap(a, b);
            [a, b].forEach((p) => {
                const cell = cellEl(p);
                cell.classList.add('tp-shake');
                setTimeout(() => cell.classList.remove('tp-shake'), 320);
            });
            breakCombo();
            fx('onTenMiss');
            setTimeout(() => {
                if (id !== gameId) return;
                busy = false;
                clearHint();
            }, SWAP_MS);
        }, SWAP_MS + 40);
    }

    function scoreMatch(matches) {
        const now = performance.now();
        combo = now - lastClearAt <= COMBO_WINDOW_MS ? combo + 1 : 1;
        maxCombo = Math.max(maxCombo, combo);
        const union = [];
        matches.forEach(({ line }) => line.forEach((p) => { if (!union.some((q) => same(q, p))) union.push(p); }));
        const result = resolveClear(union);
        const feverMult = feverOn ? 2 : 1;
        const cross = matches.length >= 2;
        let base = 0;
        matches.forEach(({ line, sum }) => { base += linePoints(line.length, sum); });
        const points = Math.round(base * (cross ? 1.5 : 1) * comboMultiplier(combo) *
            (result.stars ? 2 : 1) * feverMult) + result.extra.length * 15 * feverMult;
        score += points;

        animateClear(result);
        const big = matches.some(({ line }) => line.length === 3);
        const twenty = matches.some(({ sum }) => sum === 20);
        fx('onTenClear', { cells: union.map(cellEl), combo, points, length: union.length, star: result.stars > 0, fever: feverOn });
        if (result.stars) banner('★ 점수 2배!', 2);
        else if (cross) banner('크로스!', 2);
        else if (twenty) banner('더블 텐!', 2);
        else if (combo >= 3 && combo % 5 === 0) banner(`${combo} COMBO!`, combo >= 10 ? 3 : 2);
        else if (combo === 3) banner('3 COMBO!', 1);

        addTime(1 + (big ? 1 : 0) + (cross ? 1 : 0));
        if (combo >= 4 && combo % 4 === 0) giveItem();
        addFever(8 + 3 * Math.min(combo, 6) + (big ? 6 : 0) + (cross ? 8 : 0));
        restartComboWindow();
        popThenChain(result);
    }

    function breakCombo() {
        combo = 0;
        clearTimeout(comboTimer);
        gaugeEl.parentElement.classList.remove('active');
        if (comboEl) comboEl.textContent = '-';
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

    // === Clearing ===
    // Works out what a clear takes: ice only cracks on its first hit, bombs take their
    // four neighbours with them (and set off other bombs).
    function resolveClear(list) {
        const removed = new Map();
        const cracked = [];
        const extra = [];
        let stars = 0;
        let bombs = 0;
        const hit = (p, fromBomb) => {
            const k = keyOf(p);
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

    // After a fall: pairs making 10 that formed on their own (three-cell lines form so easily
    // that they would empty the board by themselves). A pair only counts if its cells fell
    // different distances (cells that fell together were already touching before).
    function findChainMatches(drops) {
        const taken = new Set();
        const found = [];
        const skip = (line) => line.some((p) => taken.has(keyOf(p))) ||
            new Set(line.map(([r, c]) => drops[r][c])).size < 2;
        for (let r = SIZE - 1; r >= 0; r--) {
            for (let c = 0; c < SIZE; c++) {
                if (!grid[r][c] || !drops[r][c] || taken.has(r * SIZE + c)) continue;
                const best = bestLineThrough(grid, [r, c], skip, [2]);
                if (!best) continue;
                best.line.forEach((p) => taken.add(keyOf(p)));
                found.push(best);
            }
        }
        return found;
    }

    function runChain(drops, step, id) {
        if (finished || id !== gameId) return;
        const matches = step <= 12 ? findChainMatches(drops) : [];
        if (!matches.length) {
            settle(id);
            return;
        }
        maxChain = Math.max(maxChain, step);
        const union = matches.flatMap(({ line }) => line);
        const result = resolveClear(union);
        const feverMult = feverOn ? 2 : 1;
        let base = 0;
        matches.forEach(({ line, sum }) => { base += linePoints(line.length, sum) + 10; });
        const points = (base * step + result.extra.length * 15) * (result.stars ? 2 : 1) * feverMult;
        score += points;
        animateClear(result);
        fx('onTenChain', { cells: union.map(cellEl), step, points });
        banner(step === 1 ? '연쇄!' : `${step}연쇄!`, step >= 3 ? 3 : 2);
        addTime(1);
        addFever(Math.min(12, 4 * matches.length));

        setTimeout(() => {
            if (id !== gameId) return;
            const next = applyClear(result);
            render(next);
            setTimeout(() => runChain(next, step + 1, id), CHAIN_WAIT_MS);
        }, POP_MS);
    }

    // Everything has landed: hand control back, and shuffle if no swap can match any more.
    function settle(id) {
        if (finished || id !== gameId) return;
        busy = false;
        restartComboWindow();
        clearHint();
        render();
        checkStuck();
    }

    // Items that can still do something: hammer / rainbow need a cell, a joker needs a number.
    function usefulItems() {
        const flat = grid.flat();
        const anyCell = flat.some((v) => v);
        const anyNumber = flat.some((v) => v > 0);
        return (anyCell && (items.hammer > 0 || items.rainbow > 0)) || (anyNumber && items.joker > 0);
    }

    function checkStuck() {
        if (finished) return;
        if (!grid.flat().some((v) => v > 0)) {
            setTimeout(() => finish('stuck'), 650);     // only jokers (or nothing) left: done
            return;
        }
        if (findSwap()) return;
        if (autoShuffle()) return;
        if (usefulItems()) {
            setHint('더 바꿀 곳이 없어요! 아이템을 써 보세요', 'warn');
            return;
        }
        setTimeout(() => finish('stuck'), 650);
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

    // Mixes the numbers (keeping the shape) until some swap can match. False if it can't.
    function autoShuffle() {
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
        if (pieces.length < 2) return false;
        for (let attempt = 0; attempt < 120; attempt++) {
            const order = pieces.slice();
            for (let i = order.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [order[i], order[j]] = [order[j], order[i]];
            }
            const trial = grid.map((row) => row.slice());
            spots.forEach(([r, c], i) => { trial[r][c] = order[i][0]; });
            if (!findSwap(trial)) continue;
            spots.forEach(([r, c], i) => {
                grid[r][c] = order[i][0];
                special[r][c] = order[i][1];
            });
            setPicked(null);
            breakCombo();
            banner('🔀 섞는 중!', 1);
            fx('onTenShuffle');
            render();
            cells.forEach((cell) => {
                if (cell.classList.contains('tp-empty')) return;
                cell.classList.add('tp-mix');
                setTimeout(() => cell.classList.remove('tp-mix'), 420);
            });
            return true;
        }
        return false;
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
        clearHint();
        if (finished || busy) return;
        if (itemMode === type) {
            cancelItem();
            return;
        }
        if (items[type] <= 0) return;
        itemMode = type;
        setPicked(null);
        renderItems();
        setHint();
    }

    function cancelItem() {
        itemMode = null;
        renderItems();
        setHint();
    }

    function useItemOn(p) {
        if (!at(p)) return;
        const type = itemMode;
        if (type === 'joker' && at(p) === JOKER) return;
        items[type]--;
        itemMode = null;
        renderItems();
        if (type === 'hammer') useHammer(p);
        else if (type === 'rainbow') useRainbow(p);
        else useJoker(p);
    }

    function useHammer(p) {
        busy = true;
        const result = resolveClear([p]);
        animateClear(result);
        fx('onTenItem', { type: 'hammer', cell: cellEl(p) });
        score += result.extra.length * 15 * (feverOn ? 2 : 1);
        popThenChain(result);
    }

    // Every cell with the same number pops (a joker picks the most common number).
    function useRainbow(p) {
        busy = true;
        let value = at(p);
        if (value === JOKER) {
            const counts = {};
            grid.flat().forEach((v) => { if (v > 0) counts[v] = (counts[v] || 0) + 1; });
            value = Number(Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0]) || 0;
        }
        const targets = [];
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                if (grid[r][c] === value || (r === p[0] && c === p[1])) targets.push([r, c]);
            }
        }
        const result = resolveClear(targets);
        const points = (result.removed.length * 15) * (result.stars ? 2 : 1) * (feverOn ? 2 : 1);
        score += points;
        animateClear(result);
        fx('onTenItem', { type: 'rainbow', cell: cellEl(p) });
        fx('onTenChain', { cells: result.removed.map(cellEl), step: 2, points });
        banner(`🌈 ${value || ''} 모두!`, 3);
        addTime(1);
        popThenChain(result);
    }

    function useJoker(p) {
        special[p[0]][p[1]] = { type: 'joker', hp: 1, v: at(p) };
        grid[p[0]][p[1]] = JOKER;
        fx('onTenItem', { type: 'joker', cell: cellEl(p) });
        render();
        const cell = cellEl(p);
        cell.classList.add('tp-mix');
        setTimeout(() => cell.classList.remove('tp-mix'), 420);
        checkStuck();
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
        setHint();
    }

    function endFever() {
        clearTimeout(feverTimer);
        if (!feverOn) return;
        feverOn = false;
        fever = 0;
        root.classList.remove('tp-fever-on');
        renderFever();
        fx('onTenFever', { on: false });
        setHint();
    }

    // === Result ===
    function formatTime(ms) {
        const s = Math.round(ms / 1000);
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    function finish(reason = 'stuck') {
        if (finished) return;
        finished = true;
        itemMode = null;
        press = null;
        setPicked(null);
        clearHint();
        breakCombo();
        endFever();
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
        items = { hammer: 1, rainbow: 0, joker: 1 };
        itemMode = null;
        picked = null;
        press = null;
        timeLeft = START_TIME_MS;
        playMs = 0;
        lastBeep = 0;
        hintShown = false;
        busy = false;
        finished = false;
        breakCombo();
        clearTimeout(feverTimer);
        feverOn = false;
        fever = 0;
        root.classList.remove('tp-fever-on');
        feverBar.classList.remove('on');
        resultEl.hidden = true;
        resultEl.classList.remove('active');
        render();
        if (!findSwap()) autoShuffle();
        clearHint();
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
