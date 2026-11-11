// === Combo Mode: build a 5-card "hand" from the ORDER of correct inputs ===
// Sudoku rules are untouched; this module only listens to input events from script.js.
//
// Flow: each correct input adds a card to the hand (max 5). Points are banked only when
// the hand ends: a top hand / 5 cards (banked immediately), or an input that can't
// continue any pattern (the current hand is banked and the new card starts a new hand).
// A hand is also banked early when no number left on the board could raise it.
// A mistake throws away the unbanked hand.
(function () {
    const STORAGE_KEY = 'sudoku-combo-mode';
    const HAND_SIZE = 5;

    // Paytable (also drives the help popup). `example` is shown as chips.
    const HANDS = {
        five: { name: '파이브 카드', points: 250, example: [7, 7, 7, 7, 7], desc: '같은 수 5번 연속' },
        straight5: { name: '스트레이트 5', points: 200, example: [4, 5, 6, 7, 8], desc: '연속된 수 5개 (9 8 7 6 5처럼 내림차순도 가능)' },
        fullHouse: { name: '풀하우스', points: 150, example: [2, 2, 5, 5, 5], desc: '같은 수 2개 + 같은 수 3개 (5 5 5 2 2도 가능)' },
        four: { name: '포카드', points: 120, example: [1, 1, 1, 1], desc: '같은 수 4번 연속' },
        straight4: { name: '스트레이트 4', points: 80, example: [3, 4, 5, 6], desc: '연속된 수 4개' },
        twoPair: { name: '투 페어', points: 50, example: [3, 3, 6, 6], desc: '페어 두 개를 이어서' },
        triple: { name: '트리플', points: 40, example: [7, 7, 7], desc: '같은 수 3번 연속' },
        straight3: { name: '스트레이트 3', points: 30, example: [1, 2, 3], desc: '연속된 수 3개' },
        pair: { name: '페어', points: 10, example: [4, 4], desc: '같은 수 2번 연속' },
        straight2: { name: '2연속', points: 10, example: [5, 6], desc: '연속된 수 2개' }
    };
    const SAME_BY_LEN = { 2: 'pair', 3: 'triple', 4: 'four', 5: 'five' };
    const STRAIGHT_BY_LEN = { 2: 'straight2', 3: 'straight3', 4: 'straight4', 5: 'straight5' };

    // --- Pattern helpers (seq = array of numbers in input order) ---
    function isAllSame(seq) {
        return seq.every((v) => v === seq[0]);
    }

    function isStraight(seq) {
        if (seq.length < 2) return true;
        const step = seq[1] - seq[0];
        if (step !== 1 && step !== -1) return false;
        return seq.every((v, i) => i === 0 || v - seq[i - 1] === step);
    }

    // Does seq match the first seq.length letters of a template like 'AABBB' (A ≠ B)?
    function matchesTemplatePrefix(seq, template) {
        if (seq.length > template.length) return false;
        const bound = {};
        for (let i = 0; i < seq.length; i++) {
            const letter = template[i];
            if (bound[letter] === undefined) {
                if (Object.values(bound).includes(seq[i])) return false;
                bound[letter] = seq[i];
            } else if (bound[letter] !== seq[i]) {
                return false;
            }
        }
        return true;
    }

    const MIXED_TEMPLATES = ['AABB', 'AABBB', 'AAABB'];

    // Can this hand still grow into some pattern?
    function isValidHand(seq) {
        if (seq.length === 0 || seq.length > HAND_SIZE) return false;
        if (seq.length === 1) return true;
        return isAllSame(seq) || isStraight(seq) || MIXED_TEMPLATES.some((t) => matchesTemplatePrefix(seq, t));
    }

    function exactHand(seq) {
        if (seq.length < 2) return null;
        if (isAllSame(seq)) return SAME_BY_LEN[seq.length];
        if (isStraight(seq)) return STRAIGHT_BY_LEN[seq.length];
        if (seq.length === 5 && (matchesTemplatePrefix(seq, 'AABBB') || matchesTemplatePrefix(seq, 'AAABB'))) return 'fullHouse';
        if (seq.length === 4 && matchesTemplatePrefix(seq, 'AABB')) return 'twoPair';
        return null;
    }

    // Value of a (valid) hand: the best made hand, e.g. AAB still counts as a pair.
    function handValue(seq) {
        for (let len = seq.length; len >= 2; len--) {
            const id = exactHand(seq.slice(0, len));
            if (id) return { id, ...HANDS[id] };
        }
        return null;
    }

    // The hand must end now: it is full or no further card can extend it.
    function isFinished(seq) {
        if (seq.length >= HAND_SIZE) return true;
        for (let v = 1; v <= 9; v++) {
            if (isValidHand(seq.concat(v))) return false;
        }
        return true;
    }

    // Best points reachable from seq (itself included) using only numbers still left
    // on the board. `left[v]` = how many more times v can be entered.
    function bestReachable(seq, left) {
        const value = handValue(seq);
        let best = value ? value.points : 0;
        if (seq.length >= HAND_SIZE) return best;
        for (let v = 1; v <= 9; v++) {
            if (left[v] <= 0) continue;
            const next = seq.concat(v);
            if (!isValidHand(next)) continue;
            left[v]--;
            best = Math.max(best, bestReachable(next, left));
            left[v]++;
        }
        return best;
    }

    // Can the hand still become worth more, given what is left to enter?
    // (e.g. 4 4 4 4 with no 4 left, or 7 7 7 with no 7 and no other number left twice)
    function canImprove(seq, numberCounts) {
        const left = numberCounts.map((n) => Math.max(0, 9 - n));
        const value = handValue(seq);
        return bestReachable(seq, left) > (value ? value.points : 0);
    }

    // === State ===
    let enabled = false;
    let score = 0;
    let hand = [];               // [{ key, val }]
    let lastInput = null;        // snapshot to revert the most recent input on undo/erase
    let streak = 0;              // hands banked in a row without a mistake ("heat")
    let bestHand = null;         // { name, points } best hand banked this game (shown in the result)
    const scoredCells = new Set();
    let counts = Array(10).fill(0);
    let flashTimer = null;

    // === DOM ===
    const toggleBtn = document.getElementById('combo-toggle');
    const panel = document.getElementById('combo-panel');
    const scoreEl = document.getElementById('combo-score');
    const heatEl = document.getElementById('combo-heat');
    const heatCountEl = document.getElementById('combo-heat-count');
    const slotsEl = document.getElementById('combo-slots');
    const currentEl = document.getElementById('combo-current');
    const flashEl = document.getElementById('combo-flash');
    const predictionsEl = document.getElementById('combo-predictions');
    const helpBtn = document.getElementById('combo-help-btn');
    const modal = document.getElementById('combo-modal');
    const modalClose = document.getElementById('combo-modal-close');
    const paytableEl = document.getElementById('combo-paytable');
    const numButtons = document.querySelectorAll('.num-btn');

    function loadEnabled() {
        try {
            return localStorage.getItem(STORAGE_KEY) === 'on';
        } catch (e) {
            return false;
        }
    }

    function saveEnabled() {
        try {
            localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
        } catch (e) { /* storage unavailable */ }
    }

    function handValues() {
        return hand.map((card) => card.val);
    }

    function makeChip(val, extraClass) {
        const chip = document.createElement('span');
        chip.className = 'combo-chip' + (extraClass ? ` ${extraClass}` : '');
        chip.textContent = val;
        return chip;
    }

    function showFlash(text, tone) {
        flashEl.textContent = text;
        flashEl.className = `combo-flash show ${tone}`;
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => {
            flashEl.className = 'combo-flash';
        }, 1500);
    }

    // Forward an event to effects.js when it is loaded.
    function emitEffect(name, payload) {
        const fx = window.ComboEffects;
        if (fx && typeof fx[name] === 'function') fx[name](payload);
    }

    function bankHand() {
        const value = handValue(handValues());
        if (value) {
            const prevScore = score;
            score += value.points;
            streak++;
            if (!bestHand || value.points > bestHand.points) bestHand = { name: value.name, points: value.points };
            showFlash(`${value.name} 확정 +${value.points}`, 'good');
            emitEffect('onBank', {
                ...value,
                keys: hand.map((card) => card.key),
                prevScore,
                score,
                streak,
                getScore: () => score
            });
        }
        hand = [];
        return value ? value.points : 0;
    }

    // What happens for each possible next number (only numbers that extend the hand).
    function getPredictions() {
        if (hand.length === 0) return [];
        const base = handValues();
        const current = handValue(base);
        const currentPoints = current ? current.points : 0;
        const list = [];
        for (let val = 1; val <= 9; val++) {
            if (counts[val] >= 9) continue;
            const next = base.concat(val);
            if (!isValidHand(next)) continue;
            const value = handValue(next);
            // Only numbers that raise the hand (e.g. 6 6 → 1 keeps a pair: not worth listing).
            if (!value || value.points <= currentPoints) continue;
            list.push({ val, ...value, finishes: isFinished(next) });
        }
        return list.sort((a, b) => b.points - a.points || a.val - b.val);
    }

    function render() {
        document.body.classList.toggle('combo-on', enabled);
        toggleBtn.classList.toggle('combo-active', enabled);
        toggleBtn.setAttribute('aria-pressed', String(enabled));
        panel.hidden = !enabled;

        if (!enabled) {
            numButtons.forEach((btn) => delete btn.dataset.comboPoints);
            return;
        }

        scoreEl.textContent = score.toLocaleString();

        const heat = Math.min(streak, 5);
        panel.dataset.heat = heat;
        heatEl.hidden = streak < 2;
        heatCountEl.textContent = streak;
        heatEl.title = `실수 없이 ${streak}패 연속 확정`;

        slotsEl.replaceChildren();
        for (let i = 0; i < HAND_SIZE; i++) {
            if (hand[i]) {
                slotsEl.appendChild(makeChip(hand[i].val, i === hand.length - 1 ? 'latest' : ''));
            } else {
                slotsEl.appendChild(makeChip('', 'empty'));
            }
        }

        const current = handValue(handValues());
        currentEl.textContent = current
            ? `${current.name} · ${current.points}점`
            : hand.length === 0 ? '새 패' : '족보 없음';

        const predictions = getPredictions();
        const pointsByVal = new Map(predictions.map((p) => [p.val, p.points]));
        numButtons.forEach((btn) => {
            const val = parseInt(btn.getAttribute('data-val'));
            if (pointsByVal.has(val)) btn.dataset.comboPoints = pointsByVal.get(val);
            else delete btn.dataset.comboPoints;
        });

        predictionsEl.replaceChildren();
        if (predictions.length === 0) {
            const none = document.createElement('span');
            none.className = 'combo-muted';
            none.textContent = hand.length === 0 ? '아무 번호로 새 패를 시작하세요' : '이어지는 번호 없음';
            predictionsEl.appendChild(none);
            return;
        }
        predictions.slice(0, 4).forEach((p) => {
            const item = document.createElement('span');
            item.className = 'combo-pred' + (p.finishes ? ' finishes' : '');
            const num = document.createElement('b');
            num.textContent = p.val;
            const name = document.createElement('span');
            name.textContent = p.finishes ? `${p.name} 확정` : p.name;
            const pts = document.createElement('em');
            pts.textContent = p.finishes ? `+${p.points}` : `${p.points}`;
            item.append(num, name, pts);
            predictionsEl.appendChild(item);
        });
    }

    // === Paytable popup ===
    function buildPaytable() {
        paytableEl.replaceChildren();
        Object.values(HANDS).forEach((h) => {
            const row = document.createElement('div');
            row.className = 'paytable-row';

            const info = document.createElement('div');
            info.className = 'paytable-info';
            const name = document.createElement('strong');
            name.textContent = h.name;
            const desc = document.createElement('span');
            desc.textContent = h.desc;
            info.append(name, desc);

            const example = document.createElement('div');
            example.className = 'paytable-example';
            h.example.forEach((v) => example.appendChild(makeChip(v)));

            const pts = document.createElement('em');
            pts.className = 'paytable-points';
            pts.textContent = h.points;

            row.append(info, example, pts);
            paytableEl.appendChild(row);
        });
    }

    function openModal() {
        modal.hidden = false;
        modalClose.focus();
    }

    function closeModal() {
        modal.hidden = true;
        helpBtn.focus();
    }

    helpBtn.addEventListener('click', openModal);
    modalClose.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
    // Capture phase on window runs before the game's document keydown handler,
    // so number keys / Esc don't play moves while the popup is open.
    window.addEventListener('keydown', (e) => {
        if (modal.hidden) return;
        e.stopPropagation();
        if (e.key === 'Escape') {
            e.preventDefault();
            closeModal();
        }
    }, true);

    // === Public API (called from script.js) ===
    const api = {
        isEnabled() {
            return enabled;
        },

        getScore() {
            return score;
        },

        getBestHand() {
            return bestHand;
        },

        reset() {
            score = 0;
            streak = 0;
            bestHand = null;
            hand = [];
            lastInput = null;
            scoredCells.clear();
            render();
        },

        // Puzzle solved: the unfinished hand still counts.
        finishRound() {
            if (!enabled) return;
            bankHand();
            lastInput = null;
            render();
        },

        // Snapshot for saving the game in progress (restored with setState).
        getState() {
            return { score, streak, bestHand, hand: hand.slice(), lastInput, scoredCells: [...scoredCells] };
        },

        setState(state) {
            if (!state || typeof state !== 'object') return;
            const isCard = (card) => card && Number.isInteger(card.key) && Number.isInteger(card.val);
            score = Number.isFinite(state.score) ? state.score : 0;
            streak = Number.isInteger(state.streak) ? state.streak : 0;
            bestHand = state.bestHand && typeof state.bestHand.name === 'string' && Number.isInteger(state.bestHand.points)
                ? { name: state.bestHand.name, points: state.bestHand.points }
                : null;
            hand = Array.isArray(state.hand) ? state.hand.filter(isCard).slice(0, HAND_SIZE) : [];
            lastInput = state.lastInput && Number.isInteger(state.lastInput.key) && Array.isArray(state.lastInput.hand)
                ? state.lastInput
                : null;
            scoredCells.clear();
            if (Array.isArray(state.scoredCells)) state.scoredCells.forEach((key) => scoredCells.add(key));
            render();
        },

        syncCounts(newCounts) {
            counts = newCounts.slice();
            // Nothing left on the board can raise this hand: bank it now instead of
            // waiting for a card that can never come. (lastInput is kept, so undo refunds it.)
            if (enabled && handValue(handValues()) && !canImprove(handValues(), counts)) bankHand();
            render();
        },

        onCorrect(r, c, val) {
            if (!enabled) return;
            const key = r * 9 + c;

            // A cell scores only once per game, so erase-and-retype can't farm points.
            if (scoredCells.has(key)) {
                hand = [];
                lastInput = null;
                showFlash('다시 입력한 칸은 점수 없음', 'bad');
                render();
                return;
            }

            lastInput = { key, score, streak, bestHand, hand: hand.slice() };
            scoredCells.add(key);

            const next = handValues().concat(val);
            if (isValidHand(next)) {
                hand.push({ key, val });
                if (isFinished(handValues())) bankHand();
            } else {
                bankHand();
                hand = [{ key, val }];
            }
            render();
        },

        onMistake() {
            if (!enabled) return;
            const lost = handValue(handValues());
            if (lost) showFlash(`실수! ${lost.name} 날아감`, 'bad');
            emitEffect('onBreak', { hadCards: hand.length > 0 });
            hand = [];
            streak = 0;
            lastInput = null;
            render();
        },

        // A placed value was removed (erase / undo / toggle-off).
        onRemove(r, c) {
            if (!enabled) return;
            const key = r * 9 + c;

            if (lastInput && lastInput.key === key) {
                // Taking back the most recent input restores everything before it.
                const refunded = score - lastInput.score;
                score = lastInput.score;
                streak = lastInput.streak;
                bestHand = lastInput.bestHand || null;
                hand = lastInput.hand;
                scoredCells.delete(key);
                lastInput = null;
                if (refunded > 0) showFlash(`취소 -${refunded}`, 'bad');
            } else if (scoredCells.has(key)) {
                hand = [];
                lastInput = null;
            }
            render();
        }
    };

    toggleBtn.addEventListener('click', () => {
        enabled = !enabled;
        hand = [];
        streak = 0;
        lastInput = null;
        saveEnabled();
        render();
    });

    buildPaytable();
    enabled = loadEnabled();
    render();

    window.ComboMode = api;
})();
