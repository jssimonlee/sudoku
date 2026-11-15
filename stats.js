// Personal records and the daily puzzle state. Everything lives in this browser only.
//
//   PlayerStats.recordWin(...)  -> updates wins / best time / best score for that board
//   PlayerStats.daily           -> today's attempt (elapsed time, cleared), the day streak,
//                                  and the log of every date cleared (for the calendar)
(function () {
    const STATS_KEY = 'sudoku-stats';
    const DAILY_KEY = 'sudoku-daily';
    const DAILY_LOG_KEY = 'sudoku-daily-log';
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

    const isDate = (text) => typeof text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(text);

    // Every daily puzzle cleared in this browser: { 'YYYY-MM-DD': seconds } (0 = time not known).
    // A clear made before this log existed is picked up from the streak data.
    function dailyLog() {
        const saved = read(DAILY_LOG_KEY);
        const log = {};
        Object.keys(saved).forEach((date) => {
            if (isDate(date) && Number.isInteger(saved[date]) && saved[date] >= 0) log[date] = saved[date];
        });
        const old = read(DAILY_KEY);
        if (isDate(old.lastCleared) && !(old.lastCleared in log)) {
            log[old.lastCleared] = old.date === old.lastCleared && Number.isInteger(old.time) ? old.time : 0;
        }
        return log;
    }

    // Only the first clear of a date is kept.
    function logDailyClear(date, time) {
        if (!isDate(date)) return;
        const log = dailyLog();
        if (date in log && log[date] > 0) return;
        log[date] = Number.isInteger(time) && time > 0 ? time : 0;
        write(DAILY_LOG_KEY, log);
    }

    window.PlayerStats = {
        // today(-1) is yesterday, and so on
        today: (offsetDays = 0) => dateKey(offsetDays),

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
                logDailyClear(state.date, time);
                return streak;
            },

            // Calendar: which dates were cleared here, and a late clear of an earlier date
            // (it is logged but never counts for the streak).
            log: dailyLog,
            isCleared: (date) => date in dailyLog(),
            logClear: logDailyClear
        }
    };
})();
