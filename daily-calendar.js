// Daily calendar: which daily puzzles were cleared in this browser, and a way to play
// an earlier date that was missed.
//
//   - Records come from PlayerStats.daily (stats.js) and live in this browser only.
//   - Tapping a date asks the game (window.SudokuGame.playDaily) to start that date's puzzle.
//   - Only today's puzzle counts for the leaderboard and the day streak.
(function () {
    const stats = window.PlayerStats;
    const openBtn = document.getElementById('daily-cal-btn');
    const modal = document.getElementById('daily-cal-modal');
    if (!stats || !openBtn || !modal) return;

    const closeBtn = document.getElementById('daily-cal-close');
    const summaryEl = document.getElementById('daily-cal-summary');
    const monthEl = document.getElementById('daily-cal-month');
    const prevBtn = document.getElementById('daily-cal-prev');
    const nextBtn = document.getElementById('daily-cal-next');
    const gridEl = document.getElementById('daily-cal-grid');

    const MONTHS_BACK = 12;   // how far back an earlier puzzle can be picked
    let shown = null;         // month on screen: { y, m } (m: 0-11)
    let returnFocus = null;

    const pad = (n) => String(n).padStart(2, '0');
    const dateKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
    const parse = (key) => ({ y: Number(key.slice(0, 4)), m: Number(key.slice(5, 7)) - 1, d: Number(key.slice(8, 10)) });
    const monthIndex = ({ y, m }) => y * 12 + m;

    function formatTime(sec) {
        return `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
    }

    // The button shows a dot until today's puzzle is cleared.
    function refreshButton() {
        const cleared = stats.daily.isCleared(stats.today());
        openBtn.classList.toggle('has-todo', !cleared);
        openBtn.title = cleared ? 'Daily 달력 (오늘 퍼즐 완료)' : 'Daily 달력 (오늘 퍼즐을 아직 안 풀었어요)';
    }

    function render() {
        const todayKey = stats.today();
        const today = parse(todayKey);
        const log = stats.daily.log();
        const playing = window.SudokuGame ? window.SudokuGame.currentDaily() : null;
        const first = monthIndex(today) - MONTHS_BACK;

        const state = stats.daily.get();
        const streakAlive = state.lastCleared === todayKey || state.lastCleared === stats.today(-1);
        const streak = streakAlive ? state.streak : 0;
        const total = Object.keys(log).length;
        summaryEl.textContent = `🔥 연속 출석 ${streak}일 · 지금까지 ${total}일 클리어`;

        monthEl.textContent = `${shown.y}년 ${shown.m + 1}월`;
        prevBtn.disabled = monthIndex(shown) <= first;
        nextBtn.disabled = monthIndex(shown) >= monthIndex(today);

        gridEl.replaceChildren();
        const lead = new Date(Date.UTC(shown.y, shown.m, 1)).getUTCDay();
        const days = new Date(Date.UTC(shown.y, shown.m + 1, 0)).getUTCDate();
        for (let i = 0; i < lead; i++) {
            const blank = document.createElement('span');
            blank.className = 'daily-cal-blank';
            gridEl.appendChild(blank);
        }
        for (let d = 1; d <= days; d++) {
            const key = dateKey(shown.y, shown.m, d);
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'daily-cal-day';
            const num = document.createElement('span');
            num.className = 'daily-cal-num';
            num.textContent = String(d);
            const note = document.createElement('span');
            note.className = 'daily-cal-note';
            cell.append(num, note);

            const isToday = key === todayKey;
            let label = `${shown.m + 1}월 ${d}일`;
            if (key > todayKey) {
                cell.disabled = true;
                cell.classList.add('is-future');
                label += ', 아직 열리지 않음';
            } else if (key in log) {
                cell.classList.add('is-done');
                note.textContent = log[key] > 0 ? formatTime(log[key]) : '✓';
                label += `, 클리어${log[key] > 0 ? ' ' + formatTime(log[key]) : ''} (다시 풀면 연습)`;
            } else {
                cell.classList.add('is-open');
                note.textContent = isToday ? '오늘' : '';
                label += isToday ? ', 오늘의 퍼즐' : ', 안 푼 퍼즐';
            }
            if (isToday) cell.classList.add('is-today');
            if (key === playing) cell.classList.add('is-playing');
            cell.setAttribute('aria-label', label);
            cell.addEventListener('click', () => {
                if (window.SudokuGame && window.SudokuGame.playDaily(key)) close();
            });
            gridEl.appendChild(cell);
        }
    }

    function open() {
        const today = parse(stats.today());
        shown = { y: today.y, m: today.m };
        returnFocus = document.activeElement;
        render();
        modal.hidden = false;
        closeBtn.focus();
    }

    function close() {
        modal.hidden = true;
        refreshButton();
        if (returnFocus && document.contains(returnFocus) && typeof returnFocus.focus === 'function') returnFocus.focus();
    }

    function shift(by) {
        const index = monthIndex(shown) + by;
        shown = { y: Math.floor(index / 12), m: index % 12 };
        render();
    }

    openBtn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    prevBtn.addEventListener('click', () => shift(-1));
    nextBtn.addEventListener('click', () => shift(1));
    modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
    });
    // Capture before the game's key handler so keys don't play moves behind the popup.
    window.addEventListener('keydown', (e) => {
        if (modal.hidden) return;
        e.stopPropagation();
        if (e.key === 'Escape') {
            e.preventDefault();
            close();
        }
    }, true);

    refreshButton();
    window.DailyCalendar = { refresh: refreshButton };
})();
