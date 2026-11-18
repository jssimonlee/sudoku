// 합 10 지우기: a bonus game played on the board you just solved.
// Drag (or tap the two ends of) a straight row/column run of numbers that adds up to 10.
// The run disappears and the numbers above fall down. Nothing new comes in, so the
// board slowly empties. A solved Sudoku always adds up to 405, so at best 5 is left over.
(() => {
    const SIZE = 9;
    const COMBO_WINDOW_MS = 2500;   // clear again within this time to keep the combo going
    const POP_MS = 180;
    const BEST_KEY = 'sudoku-tenpop-best';
    const PERFECT_LEFT = 5;         // 405 is not a multiple of 10: 5 is the best possible leftover

    // Points for one clear by how many cells it takes; longer runs are worth more.
    function basePoints(len) {
        if (len <= 2) return 20;
        if (len === 3) return 40;
        if (len === 4) return 70;
        return 100 + (len - 5) * 40;
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
        return { score: 0, left: null, combo: 0, plays: 0 };
    }

    function saveBest(best) {
        try {
            localStorage.setItem(BEST_KEY, JSON.stringify(best));
        } catch (e) { /* storage unavailable */ }
    }

    // === State ===
    let startGrid = null;   // the solved board, kept for "다시 하기"
    let grid = [];          // 0 = empty
    let score = 0;
    let combo = 0;
    let maxCombo = 0;
    let cleared = 0;
    let lastClearAt = 0;
    let comboTimer = null;
    let shufflesLeft = 1;
    let busy = false;
    let finished = false;
    let anchor = null;      // [r, c] picked by a tap, waiting for the other end
    let drag = null;        // { start: [r, c], cells: [[r, c]...], moved }

    // === DOM (built once, on first open) ===
    let root, boardEl, cells, scoreEl, comboEl, leftEl, gaugeEl, hintEl, shuffleBtn, finishBtn, resultEl, wrapEl;

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

        wrapEl = el('div', 'tp-board-wrap');
        boardEl = el('div', 'tp-board');
        cells = [];
        for (let i = 0; i < SIZE * SIZE; i++) {
            const cell = el('div', 'tp-cell');
            cell.dataset.i = i;
            boardEl.append(cell);
            cells.push(cell);
        }
        resultEl = el('div', 'tp-result');
        resultEl.hidden = true;
        wrapEl.append(boardEl, resultEl);

        hintEl = el('p', 'tp-hint');
        hintEl.setAttribute('aria-live', 'polite');

        const actions = el('div', 'tp-actions');
        shuffleBtn = el('button', 'tp-btn');
        shuffleBtn.type = 'button';
        shuffleBtn.addEventListener('click', shuffle);
        finishBtn = el('button', 'tp-btn tp-btn-ghost', '그만하기');
        finishBtn.type = 'button';
        finishBtn.addEventListener('click', () => finish());
        actions.append(shuffleBtn, finishBtn);

        inner.append(head, hud, gauge, wrapEl, hintEl, actions);
        root.append(inner);
        document.body.append(root);

        // Mouse / pen use pointer events. Fingers use touch events with preventDefault:
        // phones (iOS Safari above all) otherwise take the move as a scroll and cancel the drag.
        boardEl.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') onPointerDown(e); });
        boardEl.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') onPointerMove(e); });
        boardEl.addEventListener('pointerup', (e) => { if (e.pointerType !== 'touch') onPointerUp(e); });
        boardEl.addEventListener('pointercancel', (e) => { if (e.pointerType !== 'touch') cancelDrag(); });
        const firstTouch = (e) => e.changedTouches[0];
        boardEl.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (e.touches.length > 1) return;   // ignore a second finger
            onPointerDown(firstTouch(e), true);
        }, { passive: false });
        boardEl.addEventListener('touchmove', (e) => {
            e.preventDefault();
            onPointerMove(firstTouch(e));
        }, { passive: false });
        boardEl.addEventListener('touchend', (e) => {
            e.preventDefault();
            onPointerUp(firstTouch(e));
        }, { passive: false });
        boardEl.addEventListener('touchcancel', cancelDrag);
        document.addEventListener('keydown', (e) => {
            if (!root.hidden && e.key === 'Escape') close();
        });
    }

    // === Board helpers ===
    const at = ([r, c]) => grid[r][c];
    const cellEl = ([r, c]) => cells[r * SIZE + c];

    function leftSum() {
        return grid.reduce((sum, row) => sum + row.reduce((a, v) => a + v, 0), 0);
    }

    // Is there any straight run (2+ cells, no gaps) adding up to exactly 10?
    function hasMove(g = grid) {
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                if (!g[r][c]) continue;
                for (const [dr, dc] of [[0, 1], [1, 0]]) {
                    let sum = 0;
                    for (let k = 0; ; k++) {
                        const rr = r + dr * k;
                        const cc = c + dc * k;
                        if (rr >= SIZE || cc >= SIZE || !g[rr][cc]) break;
                        sum += g[rr][cc];
                        if (sum === 10 && k > 0) return true;
                        if (sum > 10) break;
                    }
                }
            }
        }
        return false;
    }

    // Cells from a to b along the row or column. Off-line ends snap to the stronger direction,
    // so a slightly wobbly drag still follows the line.
    function lineCells(a, b) {
        let [r1, c1] = b;
        const [r0, c0] = a;
        if (r1 !== r0 && c1 !== c0) {
            if (Math.abs(r1 - r0) > Math.abs(c1 - c0)) c1 = c0; else r1 = r0;
        }
        const out = [];
        const dr = Math.sign(r1 - r0);
        const dc = Math.sign(c1 - c0);
        const n = Math.max(Math.abs(r1 - r0), Math.abs(c1 - c0));
        for (let k = 0; k <= n; k++) out.push([r0 + dr * k, c0 + dc * k]);
        return out;
    }

    function inSameLine(a, b) {
        return a[0] === b[0] || a[1] === b[1];
    }

    // === Rendering ===
    function render(drops = null) {
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                const cell = cells[r * SIZE + c];
                const v = grid[r][c];
                cell.textContent = v ? String(v) : '';
                cell.className = v ? `tp-cell tp-v${v}` : 'tp-cell tp-empty';
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
        paintSelection();
    }

    function selectionCells() {
        if (drag && drag.cells.length) return drag.cells;
        if (anchor) return [anchor];
        return [];
    }

    function paintSelection() {
        cells.forEach((cell) => cell.classList.remove('tp-sel', 'tp-sel-ok', 'tp-sel-over', 'tp-sel-gap', 'tp-anchor'));
        const sel = selectionCells();
        if (!sel.length) {
            setHint();
            return;
        }
        const hasGap = sel.some((p) => !at(p));
        const sum = sel.reduce((a, p) => a + at(p), 0);
        const state = hasGap ? 'tp-sel-gap' : sum === 10 && sel.length >= 2 ? 'tp-sel-ok' : sum > 10 ? 'tp-sel-over' : '';
        sel.forEach((p) => {
            const cell = cellEl(p);
            cell.classList.add('tp-sel');
            if (state) cell.classList.add(state);
        });
        if (!drag && anchor) cellEl(anchor).classList.add('tp-anchor');

        if (hasGap) {
            setHint('빈칸을 건너뛸 수는 없어요', 'warn');
        } else if (sel.length === 1) {
            setHint(`${sum} · 같은 줄의 다른 칸을 눌러 이어 보세요`);
        } else {
            const expr = sel.map(at).join(' + ');
            setHint(`${expr} = ${sum}`, sum === 10 ? 'ok' : sum > 10 ? 'warn' : '');
        }
    }

    function setHint(text, tone = '') {
        if (text === undefined) {
            if (finished) {
                text = '';
            } else if (!hasMove()) {
                text = shufflesLeft > 0 ? '막혔어요! 셔플로 섞어 보세요' : '더 지울 수 있는 칸이 없어요';
                tone = 'warn';
            } else {
                text = '가로·세로로 이어진 칸을 드래그해 합 10을 만드세요';
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

    // === Input ===
    function pointToCell(e) {
        const rect = boardEl.getBoundingClientRect();
        const c = Math.floor(((e.clientX - rect.left) / rect.width) * SIZE);
        const r = Math.floor(((e.clientY - rect.top) / rect.height) * SIZE);
        if (r < 0 || c < 0 || r >= SIZE || c >= SIZE) return null;
        return [r, c];
    }

    // e: a PointerEvent, or a Touch (fromTouch) — both carry clientX / clientY.
    function onPointerDown(e, fromTouch = false) {
        if (busy || finished) return;
        const p = pointToCell(e);
        if (!p) return;
        if (!fromTouch) {
            e.preventDefault();
            try { boardEl.setPointerCapture(e.pointerId); } catch (err) { /* not supported */ }
        }
        drag = { start: p, cells: [p], moved: false };
        paintSelection();
    }

    function onPointerMove(e) {
        if (!drag) return;
        const p = pointToCell(e);
        if (!p) return;
        const last = drag.cells[drag.cells.length - 1];
        const next = lineCells(drag.start, p);
        const end = next[next.length - 1];
        if (end[0] === last[0] && end[1] === last[1] && next.length === drag.cells.length) return;
        drag.cells = next;
        if (next.length > 1) {
            drag.moved = true;
            anchor = null;
        }
        paintSelection();
    }

    function onPointerUp(e) {
        if (!drag) return;
        const current = drag;
        drag = null;
        if (current.moved && current.cells.length > 1) {
            tryClear(current.cells);
            return;
        }
        // A tap: the first tap picks one end, a tap on the same line picks the other end.
        const p = current.start;
        if (!at(p)) {
            anchor = null;
        } else if (!anchor) {
            anchor = p;
            fx('onTenPick');
        } else if (anchor[0] === p[0] && anchor[1] === p[1]) {
            anchor = null;
        } else if (inSameLine(anchor, p)) {
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
    function tryClear(line) {
        const sum = line.reduce((a, p) => a + at(p), 0);
        if (line.length >= 2 && line.every((p) => at(p)) && sum === 10) {
            clearLine(line);
        } else {
            miss(line);
        }
    }

    function miss(line) {
        // A wrong try ends the combo, so speed doesn't turn into random dragging.
        breakCombo();
        line.forEach((p) => {
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

    function clearLine(line) {
        busy = true;
        const now = performance.now();
        combo = now - lastClearAt <= COMBO_WINDOW_MS ? combo + 1 : 1;
        lastClearAt = now;
        maxCombo = Math.max(maxCombo, combo);
        const points = Math.round(basePoints(line.length) * comboMultiplier(combo));
        score += points;
        cleared += line.length;

        const lineEls = line.map(cellEl);
        lineEls.forEach((cell) => cell.classList.add('tp-pop'));
        fx('onTenClear', { cells: lineEls, combo, points, length: line.length });
        if (combo >= 3 && combo % 5 === 0) banner(`${combo} COMBO!`, combo >= 10 ? 3 : 2);
        else if (combo === 3) banner('3 COMBO!', 1);
        else if (line.length >= 4) banner(line.length >= 5 ? `${line.length}칸 연결!` : '4칸 연결!', line.length >= 5 ? 2 : 1);

        // Combo gauge drains over the window; when it runs out the combo is over.
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

        setTimeout(() => {
            line.forEach(([r, c]) => { grid[r][c] = 0; });
            const drops = applyGravity();
            busy = false;
            render(drops);
            checkStuck();
        }, POP_MS);
    }

    // Numbers fall straight down into the gaps. Returns how far each cell fell.
    function applyGravity() {
        const drops = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
        for (let c = 0; c < SIZE; c++) {
            let write = SIZE - 1;
            const column = [];
            for (let r = SIZE - 1; r >= 0; r--) {
                if (grid[r][c]) column.push([r, grid[r][c]]);
            }
            for (let r = 0; r < SIZE; r++) grid[r][c] = 0;
            for (const [from, v] of column) {
                grid[write][c] = v;
                drops[write][c] = write - from;
                write--;
            }
        }
        return drops;
    }

    function shuffle() {
        if (finished || busy || shufflesLeft <= 0) return;
        const spots = [];
        const values = [];
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                if (grid[r][c]) {
                    spots.push([r, c]);
                    values.push(grid[r][c]);
                }
            }
        }
        if (values.length < 2) return;
        // Keep the shape, mix the numbers; try a few times to leave at least one move.
        let next = null;
        for (let attempt = 0; attempt < 80; attempt++) {
            for (let i = values.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [values[i], values[j]] = [values[j], values[i]];
            }
            const trial = grid.map((row) => row.slice());
            spots.forEach(([r, c], i) => { trial[r][c] = values[i]; });
            next = trial;
            if (hasMove(trial)) break;
        }
        grid = next;
        shufflesLeft--;
        anchor = null;
        breakCombo();
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
        if (shufflesLeft > 0) {
            shuffleBtn.classList.add('tp-attn');
            setHint();
            return;
        }
        setTimeout(() => finish(), 650);
    }

    // === Result ===
    function finish() {
        if (finished) return;
        finished = true;
        anchor = null;
        drag = null;
        breakCombo();
        shuffleBtn.classList.remove('tp-attn');
        const left = leftSum();
        const perfect = left === PERFECT_LEFT;

        const best = loadBest();
        const newScore = score > (best.score || 0);
        const newLeft = best.left === null || best.left === undefined || left < best.left;
        const isFirst = !best.plays;
        best.plays = (best.plays || 0) + 1;
        if (newScore) best.score = score;
        if (newLeft) best.left = left;
        best.combo = Math.max(best.combo || 0, maxCombo);
        saveBest(best);

        render();
        resultEl.replaceChildren();
        const card = el('div', 'tp-result-card');
        card.append(el('span', 'tp-kicker', perfect ? '최고의 마무리' : '보너스 결과'));
        card.append(el('strong', 'tp-result-score', score.toLocaleString()));
        card.append(el('span', 'tp-result-unit', '점'));

        if (perfect || (newScore && !isFirst)) {
            const stamps = el('div', 'tp-stamps');
            if (perfect) stamps.append(el('span', 'tp-stamp tp-stamp-perfect', 'PERFECT'));
            if (newScore && !isFirst) stamps.append(el('span', 'tp-stamp tp-stamp-record', 'NEW RECORD'));
            card.append(stamps);
        }

        const rows = el('div', 'tp-result-rows');
        const row = (label, value, note = '') => {
            const line = el('div', 'tp-result-row');
            line.append(el('span', '', label), el('b', '', value));
            if (note) line.append(el('em', '', note));
            rows.append(line);
        };
        row('지운 칸', `${cleared} / 81`);
        row('최고 콤보', maxCombo >= 2 ? `×${maxCombo}` : '-');
        row('남은 합', String(left), perfect ? '이론상 최소' : `최소 기록 ${best.left}`);
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
        if (cleared > 0) fx('onTenEnd', { perfect, record: newScore && !isFirst });
    }

    // === Open / close ===
    function start(solved) {
        startGrid = solved.map((row) => row.slice());
        grid = startGrid.map((row) => row.slice());
        score = 0;
        combo = 0;
        maxCombo = 0;
        cleared = 0;
        lastClearAt = 0;
        shufflesLeft = 1;
        busy = false;
        finished = false;
        anchor = null;
        drag = null;
        breakCombo();
        shuffleBtn.classList.remove('tp-attn');
        resultEl.hidden = true;
        resultEl.classList.remove('active');
        render();
    }

    function open(solved) {
        const valid = Array.isArray(solved) && solved.length === SIZE &&
            solved.every((row) => Array.isArray(row) && row.length === SIZE && row.every((v) => v >= 1 && v <= 9));
        if (!valid) return false;
        if (!root) build();
        start(solved);
        root.hidden = false;
        document.body.classList.add('tp-open');
        requestAnimationFrame(() => root.classList.add('active'));
        return true;
    }

    function close() {
        if (!root) return;
        clearTimeout(comboTimer);
        root.classList.remove('active');
        document.body.classList.remove('tp-open');
        setTimeout(() => { if (!root.classList.contains('active')) root.hidden = true; }, 200);
    }

    window.TenPop = { open, close, isOpen: () => Boolean(root && !root.hidden) };
})();
