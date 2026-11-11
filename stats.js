// Personal records and the daily puzzle state. Everything lives in this browser only.
//
//   PlayerStats.recordWin(...)  -> updates wins / best time / best score for that board
//   PlayerStats.daily           -> today's attempt (elapsed time, cleared) and the day streak
(function () {
    const STATS_KEY = 'sudoku-stats';
    const DAILY_KEY = 'sudoku-daily';
    const DAY_MS = 24 * 60 * 60 * 1000;
    const KST_OFFSET = 9 * 60 * 60 * 1000;

    function read(key) {
        try {
            const data = JSON.parse(localStorage.getItem(key));
            return data && typeof data === 'object' ? data : {};
        } catch {
            return {};
        }
    }

    function write(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify(data));
        } catch { /* storage unavailable: records just aren't kept */ }
    }

    // The daily puzzle changes at midnight Korea time, the same moment for everyone.
    function dateKey(offsetDays = 0) {
        return new Date(Date.now() + KST_OFFSET + offsetDays * DAY_MS).toISOString().slice(0, 10);
    }

    // Today's attempt; a stored attempt from another day is ignored (streak data is kept).
    function dailyState() {
        const saved = read(DAILY_KEY);
        const today = dateKey();
        const sameDay = saved.date === today;
        return {
            date: today,
            elapsed: sameDay && Number.isInteger(saved.elapsed) ? saved.elapsed : 0,
            cleared: sameDay && saved.cleared === true,
            time: sameDay && Number.isInteger(saved.time) ? saved.time : null,
            streak: Number.isInteger(saved.streak) ? saved.streak : 0,
            lastCleared: typeof saved.lastCleared === 'string' ? saved.lastCleared : null
        };
    }

    window.PlayerStats = {
        today: () => dateKey(),

        // key: 'normal-<difficulty>' | 'combo-<difficulty>' | 'daily'
        // Returns the new totals plus what the bests were before this win.
        recordWin(key, { time, score = null }) {
            const all = read(STATS_KEY);
            const prev = all[key] && typeof all[key] === 'object' ? all[key] : {};
            const prevBestTime = Number.isInteger(prev.bestTime) ? prev.bestTime : null;
            const prevBestScore = Number.isInteger(prev.bestScore) ? prev.bestScore : null;
            const wins = (Number.isInteger(prev.wins) ? prev.wins : 0) + 1;

            const isBestTime = prevBestTime === null || time < prevBestTime;
            const isBestScore = score !== null && (prevBestScore === null || score > prevBestScore);
            all[key] = {
                wins,
                bestTime: isBestTime ? time : prevBestTime,
                bestScore: isBestScore ? score : prevBestScore
            };
            write(STATS_KEY, all);
            return { wins, prevBestTime, prevBestScore, isBestTime, isBestScore, first: wins === 1 };
        },

        daily: {
            get: dailyState,

            // Time already spent on today's puzzle carries over when it is restarted.
            saveElapsed(seconds) {
                const state = dailyState();
                if (state.cleared) return;
                write(DAILY_KEY, { ...state, elapsed: seconds });
            },

            // First clear of the day. Returns the day streak (consecutive days cleared).
            markCleared(time) {
                const state = dailyState();
                if (state.cleared) return state.streak;
                const streak = state.lastCleared === dateKey(-1) ? state.streak + 1 : 1;
                write(DAILY_KEY, { ...state, elapsed: time, cleared: true, time, streak, lastCleared: state.date });
                return streak;
            }
        }
    };
})();
