// TOP 10 leaderboard client.
//
// After a win the record is compared with the cached boards first. Boards only ever
// get better, so if the record doesn't beat the cached 10th place it can't make the
// live top 10 either: nothing is sent. Only a record that makes the cached top 10
// asks for initials and goes to the server, which re-checks it and returns the
// fresh boards (the cache is then replaced).
(function () {
    const config = window.SUDOKU_LEADERBOARD_CONFIG || {};
    const apiBase = String(config.apiBase || '').replace(/\/+$/, '');
    const siteKey = String(config.turnstileSiteKey || '');

    const CACHE_KEY = 'sudoku-leaderboard-cache';
    const INITIALS_KEY = 'sudoku-initials';
    const TOP_N = 10;
    const VIEW_MAX_AGE = 24 * 60 * 60 * 1000;     // refresh the table view once a day
    const WIN_MAX_AGE = 7 * 24 * 60 * 60 * 1000;  // win checks may use an older cache
    const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'];
    const DIFF_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };
    const KIND_LABEL = { normal: '일반', 'combo-time': '콤보 시간', 'combo-score': '콤보 점수' };
    const ERROR_TEXT = {
        rate_limited: '잠시 후 다시 시도해 주세요.',
        bad_initials: '이니셜은 영문·숫자 3글자예요.',
        blocked_initials: '다른 이니셜을 써 주세요.',
        turnstile_failed: '봇 확인에 실패했어요. 다시 시도해 주세요.',
        forbidden_origin: '이 주소에서는 등록할 수 없어요.',
        bad_time: '기록이 비정상적으로 빨라 등록할 수 없어요.',
        bad_score: '콤보 점수가 올바르지 않아 등록할 수 없어요.'
    };
    // Same minimum clear times as the Worker: faster records are rejected there, so don't send them.
    const MIN_TIME = { easy: 30, medium: 45, hard: 60, expert: 75 };

    // === DOM ===
    const toggleBtn = document.getElementById('lb-toggle');
    const modal = document.getElementById('lb-modal');
    const closeBtn = document.getElementById('lb-modal-close');
    const form = document.getElementById('lb-submit');
    const qualifyList = document.getElementById('lb-qualify');
    const initialsInput = document.getElementById('lb-initials');
    const turnstileBox = document.getElementById('lb-turnstile');
    const submitMsg = document.getElementById('lb-submit-msg');
    const skipBtn = document.getElementById('lb-skip');
    const sendBtn = document.getElementById('lb-send');
    const resultEl = document.getElementById('lb-result');
    const tabs = document.querySelectorAll('#lb-tabs [data-kind]');
    const diffBtns = document.querySelectorAll('#lb-diffs [data-diff]');
    const table = document.getElementById('lb-table');
    const statusEl = document.getElementById('lb-status');

    if (!apiBase || !modal) {
        window.Leaderboard = { onWin() {} };
        return;
    }
    toggleBtn.hidden = false;

    let view = { kind: 'normal', difficulty: 'medium', highlight: null };
    let pending = null;          // record waiting for initials
    let turnstileId = null;
    let turnstileToken = '';
    let returnFocus = null;

    // === Ranking (same rules as the Worker) ===
    function boardKey(kind, difficulty) {
        return `${kind}-${difficulty}`;
    }

    // Negative when a ranks above b. A new record has no createdAt yet, so it loses ties.
    function compare(kind, a, b) {
        if (kind === 'combo-score' && a.score !== b.score) return b.score - a.score;
        if (a.time !== b.time) return a.time - b.time;
        if (kind !== 'combo-score' && a.mistakes !== b.mistakes) return a.mistakes - b.mistakes;
        return (a.createdAt ?? Infinity) - (b.createdAt ?? Infinity);
    }

    function expectedRank(kind, list, entry) {
        const pos = list.findIndex((row) => compare(kind, entry, row) < 0);
        const rank = pos === -1 ? list.length + 1 : pos + 1;
        return rank <= TOP_N ? rank : null;
    }

    // === Cache ===
    function readCache() {
        try {
            const cache = JSON.parse(localStorage.getItem(CACHE_KEY));
            if (cache && cache.boards && Number.isFinite(cache.fetchedAt)) return cache;
        } catch { /* ignore */ }
        return null;
    }

    function writeCache(boards) {
        const cache = { fetchedAt: Date.now(), boards };
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
        } catch { /* storage unavailable */ }
        return cache;
    }

    async function fetchBoards() {
        const res = await fetch(`${apiBase}/leaderboards`, { headers: { Accept: 'application/json' } });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return writeCache(data.boards);
    }

    // Cached boards if fresh enough, otherwise one GET (falls back to a stale cache offline).
    async function getBoards(maxAge) {
        const cache = readCache();
        if (cache && Date.now() - cache.fetchedAt < maxAge) return cache;
        try {
            return await fetchBoards();
        } catch (err) {
            if (cache) return cache;
            throw err;
        }
    }

    // === Formatting ===
    function formatTime(sec) {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function recordText(kind, entry) {
        return kind === 'combo-score' ? `${entry.score.toLocaleString()}점` : formatTime(entry.time);
    }

    // === Modal ===
    function openModal() {
        returnFocus = document.activeElement;
        modal.hidden = false;
    }

    function closeModal() {
        modal.hidden = true;
        form.hidden = true;
        pending = null;
        if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
    }

    function setStatus(text) {
        statusEl.textContent = text;
        statusEl.hidden = !text;
    }

    function renderView(boards) {
        tabs.forEach((tab) => {
            const active = tab.dataset.kind === view.kind;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', String(active));
        });
        diffBtns.forEach((btn) => btn.classList.toggle('active', btn.dataset.diff === view.difficulty));

        const list = (boards && boards[boardKey(view.kind, view.difficulty)]) || [];
        table.replaceChildren();
        if (list.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'lb-empty';
            empty.textContent = '아직 기록이 없어요. 첫 기록의 주인공이 되어 보세요!';
            table.appendChild(empty);
            return;
        }
        list.forEach((row, i) => {
            const li = document.createElement('li');
            li.className = 'lb-row' + (view.highlight === i + 1 ? ' lb-me' : '') + (i < 3 ? ` lb-top${i + 1}` : '');
            const rank = document.createElement('span');
            rank.className = 'lb-rank';
            rank.textContent = i + 1;
            const name = document.createElement('span');
            name.className = 'lb-name';
            name.textContent = row.initials;   // textContent only: never HTML
            const main = document.createElement('span');
            main.className = 'lb-main';
            main.textContent = recordText(view.kind, row);
            const sub = document.createElement('span');
            sub.className = 'lb-sub';
            sub.textContent = view.kind === 'combo-score' ? formatTime(row.time) : `실수 ${row.mistakes}`;
            li.append(rank, name, main, sub);
            table.appendChild(li);
        });
    }

    async function showView(kind, difficulty, { highlight = null, maxAge = VIEW_MAX_AGE } = {}) {
        view = { kind, difficulty, highlight };
        const cache = readCache();
        renderView(cache && cache.boards);
        setStatus(cache ? '' : '불러오는 중…');
        try {
            const fresh = await getBoards(maxAge);
            if (view.kind === kind && view.difficulty === difficulty) renderView(fresh.boards);
            setStatus('');
        } catch {
            setStatus(cache ? '최신 순위를 불러오지 못했어요 (저장된 순위 표시 중)' : '순위를 불러오지 못했어요.');
        }
    }

    tabs.forEach((tab) => tab.addEventListener('click', () => {
        view.highlight = null;
        showView(tab.dataset.kind, view.difficulty);
    }));
    diffBtns.forEach((btn) => btn.addEventListener('click', () => {
        view.highlight = null;
        showView(view.kind, btn.dataset.diff);
    }));

    // Header trophy: pause a running game, then show the boards for the current mode.
    toggleBtn.addEventListener('click', () => {
        const pauseOverlay = document.getElementById('pause-overlay');
        const gameOverlay = document.getElementById('game-overlay');
        const running = pauseOverlay && !pauseOverlay.classList.contains('active')
            && gameOverlay && !gameOverlay.classList.contains('active');
        if (running) document.getElementById('btn-pause').click();

        const comboOn = window.ComboMode && window.ComboMode.isEnabled();
        const difficulty = document.getElementById('difficulty').value;
        form.hidden = true;
        resultEl.hidden = true;
        openModal();
        closeBtn.focus();
        showView(comboOn ? 'combo-score' : 'normal', DIFFICULTIES.includes(difficulty) ? difficulty : 'medium');
    });

    closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // Keys typed inside the popup (initials) must not reach the game's handler.
    modal.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
            e.preventDefault();
            closeModal();
        }
    });
    // Keys aimed elsewhere while the popup is open are blocked too.
    window.addEventListener('keydown', (e) => {
        if (modal.hidden || modal.contains(e.target)) return;
        e.stopPropagation();
        if (e.key === 'Escape') {
            e.preventDefault();
            closeModal();
        }
    }, true);

    // === Initials form ===
    initialsInput.addEventListener('input', () => {
        const clean = initialsInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
        if (clean !== initialsInput.value) initialsInput.value = clean;
    });

    function loadTurnstile() {
        if (!siteKey) return Promise.resolve(null);
        if (window.turnstile) return Promise.resolve(window.turnstile);
        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
            script.async = true;
            script.onload = () => resolve(window.turnstile || null);
            script.onerror = () => resolve(null);
            document.head.appendChild(script);
        });
    }

    async function prepareTurnstile() {
        turnstileToken = '';
        turnstileBox.hidden = !siteKey;
        const ts = await loadTurnstile();
        if (!ts) return;
        if (turnstileId !== null) {
            ts.reset(turnstileId);
            return;
        }
        turnstileId = ts.render(turnstileBox, {
            sitekey: siteKey,
            callback: (token) => { turnstileToken = token; },
            'expired-callback': () => { turnstileToken = ''; }
        });
    }

    function openSubmit(record, qualifying) {
        pending = record;
        qualifyList.replaceChildren();
        qualifying.forEach(({ kind, rank }) => {
            const li = document.createElement('li');
            li.textContent = `${KIND_LABEL[kind]} ${DIFF_LABEL[record.difficulty]} · ${recordText(kind, record)} · 예상 ${rank}위`;
            qualifyList.appendChild(li);
        });
        let saved = '';
        try { saved = localStorage.getItem(INITIALS_KEY) || ''; } catch { /* ignore */ }
        initialsInput.value = /^[A-Z0-9]{3}$/.test(saved) ? saved : '';
        submitMsg.textContent = '';
        sendBtn.disabled = false;
        resultEl.hidden = true;
        form.hidden = false;
        view = { kind: qualifying[0].kind, difficulty: record.difficulty, highlight: null };
        renderView(readCache() && readCache().boards);
        setStatus('');
        openModal();
        initialsInput.focus();
        initialsInput.select();
        prepareTurnstile();
    }

    skipBtn.addEventListener('click', closeModal);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!pending) return;
        const initials = initialsInput.value.toUpperCase();
        if (!/^[A-Z0-9]{3}$/.test(initials)) {
            submitMsg.textContent = ERROR_TEXT.bad_initials;
            initialsInput.focus();
            return;
        }
        if (siteKey && !turnstileToken) {
            submitMsg.textContent = '봇 확인을 마쳐 주세요.';
            return;
        }

        sendBtn.disabled = true;
        submitMsg.textContent = '등록 중…';
        try {
            localStorage.setItem(INITIALS_KEY, initials);
        } catch { /* ignore */ }

        const record = pending;
        try {
            const res = await fetch(`${apiBase}/submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...record, initials, turnstileToken: turnstileToken || undefined })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.ok) {
                submitMsg.textContent = ERROR_TEXT[data.error] || '등록하지 못했어요. 잠시 후 다시 시도해 주세요.';
                sendBtn.disabled = false;
                if (turnstileId !== null && window.turnstile) window.turnstile.reset(turnstileId);
                turnstileToken = '';
                return;
            }

            writeCache(data.boards);
            pending = null;
            form.hidden = true;

            const kinds = record.mode === 'combo' ? ['combo-time', 'combo-score'] : ['normal'];
            const lines = kinds.map((kind) => {
                const rank = data.results[boardKey(kind, record.difficulty)];
                return rank ? `${KIND_LABEL[kind]} ${rank}위 등록!` : `${KIND_LABEL[kind]}: 아깝게 밀렸어요`;
            });
            resultEl.textContent = lines.join(' · ');
            resultEl.hidden = false;

            const best = kinds.find((kind) => data.results[boardKey(kind, record.difficulty)]) || kinds[0];
            view = { kind: best, difficulty: record.difficulty, highlight: data.results[boardKey(best, record.difficulty)] };
            renderView(data.boards);
            closeBtn.focus();
        } catch {
            submitMsg.textContent = '서버에 연결하지 못했어요. 다시 시도해 주세요.';
            sendBtn.disabled = false;
        }
    });

    // === Called by script.js after a win ===
    async function onWin(record) {
        if (!record || !DIFFICULTIES.includes(record.difficulty)) return;
        if (!Number.isInteger(record.time) || record.time < MIN_TIME[record.difficulty]) return;
        const kinds = record.mode === 'combo' ? ['combo-time', 'combo-score'] : ['normal'];
        let cache;
        try {
            cache = await getBoards(WIN_MAX_AGE);
        } catch {
            return; // offline and no cache: skip quietly
        }
        const qualifying = kinds
            .map((kind) => ({ kind, rank: expectedRank(kind, cache.boards[boardKey(kind, record.difficulty)] || [], record) }))
            .filter((q) => q.rank !== null);
        if (qualifying.length === 0) return; // not top 10: no request at all
        openSubmit(record, qualifying);
    }

    window.Leaderboard = { onWin };
})();
