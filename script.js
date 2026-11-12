document.addEventListener('DOMContentLoaded', () => {
    // === Game State ===
    let board = [];
    let initialBoard = [];
    let solution = [];
    let selectedCell = null;
    let mistakes = 0;
    const MAX_MISTAKES = 3;
    const AUTO_FILL_KEY = 'f';
    let history = [];
    let isPaused = false;
    let isRoundFinished = false;
    let isNotesMode = false;
    let notes = [];
    let selectedNumber = null; // Currently active number for quick entry
    let selectedNumberSource = null; // 'user' | 'auto'

    // Combo mode hooks (combo.js); no-op fallback keeps Sudoku working without it
    const combo = window.ComboMode || {
        isEnabled: () => false, getScore: () => 0, getBestHand: () => null, reset() {}, finishRound() {}, syncCounts() {},
        onCorrect() {}, onMistake() {}, onRemove() {}
    };

    // Optional richer game effects (effects.js); does nothing when absent or turned off
    function emitFx(name, payload) {
        const fx = window.GameEffects;
        if (fx && typeof fx[name] === 'function') fx[name](payload);
    }

    // Rows / columns / boxes through (r, c) that are now completely filled.
    // Cells are listed in board order so index 4 is the middle of the unit.
    function getCompletedUnits(r, c) {
        const row = Array.from({ length: 9 }, (_, col) => [r, col]);
        const col = Array.from({ length: 9 }, (_, row) => [row, c]);
        const box = [];
        const br = Math.floor(r / 3) * 3;
        const bc = Math.floor(c / 3) * 3;
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) box.push([br + i, bc + j]);
        }
        return [row, col, box].filter((unit) => unit.every(([ur, uc]) => board[ur][uc] !== 0));
    }

    let timerInterval;
    let secondsElapsed = 0;

    // === DOM Elements ===
    const boardElement = document.getElementById('sudoku-board');
    const healthBarsEl = document.getElementById('health-bars');
    const healthBars = document.querySelectorAll('.health-bar');
    const timerEl = document.getElementById('timer');
    const difficultySelect = document.getElementById('difficulty');
    const DIFFICULTY_STORAGE_KEY = 'sudoku-difficulty';
    const DIFFICULTY_SETTINGS = {
        easy: { cluesTarget: 51, maxAttempts: 25, fallbackTargets: [51, 52, 53] },
        medium: { cluesTarget: 41, maxAttempts: 35, fallbackTargets: [41, 42, 43] },
        hard: { cluesTarget: 31, maxAttempts: 45, fallbackTargets: [31, 32, 33] },
        expert: { cluesTarget: 27, maxAttempts: 60, fallbackTargets: [27, 28, 29, 30] },
        // Daily puzzle: Medium-sized, built from the date so everyone gets the same board.
        daily: { cluesTarget: 41, maxAttempts: 35, fallbackTargets: [41, 42, 43] }
    };
    const DAILY = 'daily';
    const DIFFICULTY_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };

    // Personal records + daily puzzle state (stats.js); the game works without it.
    const stats = window.PlayerStats || null;
    let dailyDate = null;        // 'YYYY-MM-DD' while playing the daily puzzle, else null
    let dailyPractice = false;   // today's puzzle was already cleared: replay, nothing is recorded
    let lastRegularDifficulty = 'medium';
    let rand = Math.random;      // swapped for a seeded generator while building the daily puzzle

    const numButtons = document.querySelectorAll('.num-btn');
    const btnUndo = document.getElementById('btn-undo');
    const btnErase = document.getElementById('btn-erase');
    const btnNotes = document.getElementById('btn-notes');
    const btnPause = document.getElementById('btn-pause');
    const pauseIcon = document.getElementById('pause-icon');
    const btnNewGame = document.getElementById('btn-new-game');

    const overlay = document.getElementById('game-overlay');
    const overlayContent = document.getElementById('game-overlay-content');
    const overlayKicker = document.getElementById('overlay-kicker');
    const overlayTitle = document.getElementById('overlay-title');
    const overlayMsg = document.getElementById('overlay-msg');
    const overlayBtn = document.getElementById('overlay-btn');
    const overlayStats = document.getElementById('overlay-stats');
    const pauseOverlay = document.getElementById('pause-overlay');
    const pauseResumeBtn = document.getElementById('pause-resume-btn');

    const SAVE_STORAGE_KEY = 'sudoku-saved-game';
    const SAVE_VERSION = 1;

    // === Init Game ===
    restoreDifficulty();
    if (!restoreSavedGame()) initGame();

    // Moves are allowed only while a round is running and not paused.
    function canPlay() {
        return !isPaused && !isRoundFinished && !overlay.classList.contains('active');
    }

    // === Save / restore the game in progress ===
    function saveGame() {
        if (isRoundFinished) return;
        try {
            localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify({
                v: SAVE_VERSION,
                difficulty: difficultySelect.value,
                dailyDate,
                board,
                initialBoard,
                solution,
                notes: notes.map(row => row.map(set => [...set])),
                mistakes,
                secondsElapsed,
                history,
                combo: typeof combo.getState === 'function' ? combo.getState() : null
            }));
        } catch {
            // Playing still works without browser storage.
        }
        saveDailyElapsed();
    }

    // Time spent on today's puzzle is kept, so restarting it doesn't reset the clock.
    function saveDailyElapsed() {
        if (stats && dailyDate && !dailyPractice) stats.daily.saveElapsed(secondsElapsed);
    }

    function clearSavedGame() {
        try {
            localStorage.removeItem(SAVE_STORAGE_KEY);
        } catch {
            // Nothing to clear.
        }
    }

    function isGrid(grid) {
        return Array.isArray(grid) && grid.length === 9 && grid.every(row =>
            Array.isArray(row) && row.length === 9 && row.every(v => Number.isInteger(v) && v >= 0 && v <= 9));
    }

    function loadSavedGame() {
        try {
            const saved = JSON.parse(localStorage.getItem(SAVE_STORAGE_KEY));
            if (!saved || saved.v !== SAVE_VERSION) return null;
            if (!isGrid(saved.board) || !isGrid(saved.initialBoard) || !isGrid(saved.solution)) return null;
            if (!Number.isInteger(saved.mistakes) || saved.mistakes < 0 || saved.mistakes >= MAX_MISTAKES) return null;
            const solved = saved.board.every((row, r) => row.every((v, c) => v === saved.solution[r][c]));
            if (solved) return null;
            // A daily puzzle from another day is over: today's is a different board.
            if (saved.difficulty === DAILY && (!stats || saved.dailyDate !== stats.today())) return null;
            return saved;
        } catch {
            return null;
        }
    }

    function restoreSavedGame() {
        const saved = loadSavedGame();
        if (!saved) {
            clearSavedGame();
            return false;
        }

        if (Object.prototype.hasOwnProperty.call(DIFFICULTY_SETTINGS, saved.difficulty)) {
            difficultySelect.value = saved.difficulty;
        }
        dailyDate = saved.difficulty === DAILY ? saved.dailyDate : null;
        dailyPractice = Boolean(dailyDate) && stats.daily.get().cleared;
        board = saved.board;
        initialBoard = saved.initialBoard;
        solution = saved.solution;
        notes = Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (__, c) => {
            const list = Array.isArray(saved.notes) && Array.isArray(saved.notes[r]) ? saved.notes[r][c] : null;
            return new Set(Array.isArray(list) ? list.filter(v => Number.isInteger(v) && v >= 1 && v <= 9) : []);
        }));
        mistakes = saved.mistakes;
        history = Array.isArray(saved.history) ? saved.history : [];

        overlay.classList.remove('active');
        isPaused = false;
        isRoundFinished = false;
        isNotesMode = false;
        selectedCell = null;
        clearSelectedNumber();
        updateMistakesDisplay();

        resetTimer();
        secondsElapsed = Number.isInteger(saved.secondsElapsed) && saved.secondsElapsed > 0 ? saved.secondsElapsed : 0;
        timerEl.textContent = formatTime(secondsElapsed);
        startTimer();

        renderBoard();
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (board[r][c] === 0 && notes[r][c].size > 0) renderCellNotes(r, c);
            }
        }
        combo.reset();
        if (typeof combo.setState === 'function') combo.setState(saved.combo);
        updateNumpadState({ silent: true });
        return true;
    }

    // Save when the page is hidden or closed, so the latest second is kept too.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) saveGame();
    });
    window.addEventListener('pagehide', saveGame);

    function restoreDifficulty() {
        try {
            const savedDifficulty = localStorage.getItem(DIFFICULTY_STORAGE_KEY);
            if (savedDifficulty !== DAILY && Object.prototype.hasOwnProperty.call(DIFFICULTY_SETTINGS, savedDifficulty)) {
                difficultySelect.value = savedDifficulty;
                lastRegularDifficulty = savedDifficulty;
            }
        } catch {
            // Keep the default difficulty if browser storage is unavailable.
        }
    }

    // Only the regular levels are remembered; the daily puzzle is picked on purpose each time.
    function saveDifficulty() {
        if (difficultySelect.value === DAILY) return;
        lastRegularDifficulty = difficultySelect.value;
        try {
            localStorage.setItem(DIFFICULTY_STORAGE_KEY, difficultySelect.value);
        } catch {
            // Allow playing even if browser storage is unavailable.
        }
    }

    // === Event Listeners ===
    difficultySelect.addEventListener('change', () => {
        saveDifficulty();
        initGame();
    });
    btnNewGame.addEventListener('click', initGame);
    overlayBtn.addEventListener('click', () => {
        // After the daily puzzle, "new puzzle" goes back to the regular level.
        // (After losing it, the same button retries today's puzzle.)
        if (difficultySelect.value === DAILY && (!stats || stats.daily.get().cleared)) {
            difficultySelect.value = lastRegularDifficulty;
        }
        initGame();
    });

    btnUndo.addEventListener('click', undoMove);
    btnErase.addEventListener('click', eraseCell);
    btnPause.addEventListener('click', togglePause);
    pauseResumeBtn.addEventListener('click', togglePause);

    btnNotes.addEventListener('click', () => {
        isNotesMode = !isNotesMode;
        btnNotes.classList.toggle('notes-active', isNotesMode);

        if (isNotesMode) {
            clearSelectedNumber(true);
            return;
        }

        if (selectedCell && board[selectedCell.r][selectedCell.c] === 0) {
            syncSelectedNumberForCell(selectedCell.r, selectedCell.c);
        }
    });

    numButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            if (!canPlay()) return;
            const val = parseInt(btn.getAttribute('data-val'));
            if (flashIfCompleted(val)) return;
            setSelectedNumber(val); // Mark this number as active
            if (isNotesMode) {
                inputNote(val);
            } else {
                inputNumber(val);
            }
        });
    });

    // A number that is already placed nine times can't be played: instead of doing nothing,
    // its nine cells flash so the player sees at once that it is finished.
    function flashIfCompleted(val) {
        const btn = document.querySelector(`.num-btn[data-val="${val}"]`);
        if (!btn || !btn.classList.contains('disabled')) return false;
        const cells = [];
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (board[r][c] === val) cells.push([r, c]);
            }
        }
        emitFx('onCompletedTap', { val, btn, cells });
        return true;
    }

    // Helper: set the active selected number and highlight the numpad button
    function setSelectedNumber(val, source = 'user') {
        selectedNumber = val;
        selectedNumberSource = source;
        refreshSelectedNumberUI();
    }

    function clearSelectedNumber(onlyAuto = false) {
        if (onlyAuto && selectedNumberSource !== 'auto') return;
        selectedNumber = null;
        selectedNumberSource = null;
        refreshSelectedNumberUI();
    }

    function refreshSelectedNumberUI() {
        numButtons.forEach(btn => {
            const v = parseInt(btn.getAttribute('data-val'));
            btn.classList.toggle('num-selected', v === selectedNumber);
        });
    }

    function getUnitMissingValue(cells) {
        let emptyCount = 0;
        const used = new Set();

        for (const [row, col] of cells) {
            const val = board[row][col];
            if (val === 0) {
                emptyCount++;
                continue;
            }

            used.add(val);
        }

        if (emptyCount !== 1) return null;

        for (let val = 1; val <= 9; val++) {
            if (!used.has(val)) return val;
        }

        return null;
    }

    function getLastUnitCompletionNumber(r, c) {
        if (board[r][c] !== 0 || initialBoard[r][c] !== 0) return null;

        const rowCells = Array.from({ length: 9 }, (_, col) => [r, col]);
        const colCells = Array.from({ length: 9 }, (_, row) => [row, c]);
        const boxCells = [];
        const boxRowStart = Math.floor(r / 3) * 3;
        const boxColStart = Math.floor(c / 3) * 3;

        for (let row = boxRowStart; row < boxRowStart + 3; row++) {
            for (let col = boxColStart; col < boxColStart + 3; col++) {
                boxCells.push([row, col]);
            }
        }

        const missingValues = [
            getUnitMissingValue(rowCells),
            getUnitMissingValue(colCells),
            getUnitMissingValue(boxCells)
        ].filter((val) => val !== null);

        if (missingValues.length === 0) return null;

        return missingValues.every((val) => val === missingValues[0]) ? missingValues[0] : null;
    }

    function getOnlyRemainingNumber() {
        const counts = Array(10).fill(0);
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (board[r][c] !== 0) counts[board[r][c]]++;
            }
        }

        const remaining = [];
        for (let val = 1; val <= 9; val++) {
            if (counts[val] < 9) remaining.push(val);
        }

        return remaining.length === 1 ? remaining[0] : null;
    }

    function getAutoFillNumber(r, c) {
        if (board[r][c] !== 0 || initialBoard[r][c] !== 0) return null;

        // Only fill the last empty cell of a row / column / box (8 of 9 filled),
        // or any cell once a single number is left on the whole board.
        // A cell whose candidates narrow to one is NOT filled: that would be a hint.
        const unitCompletionVal = getLastUnitCompletionNumber(r, c);
        if (unitCompletionVal !== null) return unitCompletionVal;

        return getOnlyRemainingNumber();
    }

    function syncSelectedNumberForCell(r, c) {
        if (isNotesMode) {
            clearSelectedNumber(true);
            return null;
        }

        const autoVal = getAutoFillNumber(r, c);

        if (autoVal !== null) {
            if (selectedNumberSource !== 'user') {
                setSelectedNumber(autoVal, 'auto');
            }
            return autoVal;
        }

        clearSelectedNumber(true);
        return null;
    }

    function applyShortcutInputToCell(r, c) {
        if (!canPlay()) return false;
        if (board[r][c] !== 0 || initialBoard[r][c] !== 0) return false;

        selectCell(r, c);
        if (isNotesMode) {
            if (selectedNumberSource !== 'user' || selectedNumber === null) return false;
            inputNote(selectedNumber);
            return true;
        }

        const autoVal = getAutoFillNumber(r, c);
        if (autoVal !== null) {
            inputNumber(autoVal);
            setSelectedNumber(autoVal);
            return true;
        }

        if (selectedNumber === null) return false;
        inputNumber(selectedNumber);

        return true;
    }

    function applyShortcutInputToSelectedCell() {
        if (selectedCell === null) return false;

        const { r, c } = selectedCell;
        return applyShortcutInputToCell(r, c);
    }

    function isAutoFillShortcut(event) {
        return event.key.toLowerCase() === AUTO_FILL_KEY
            || event.key === '`'
            || event.key === '~'
            || event.key === 'Escape'
            || event.code === 'Space';
    }

    // Auto-pause when tab goes invariant/hidden, or window loses focus (e.g. changing macOS Spaces)
    function handleAutoPause() {
        if (isRoundFinished) return;
        if (!isPaused && !overlay.classList.contains('active')) {
            togglePause();
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) handleAutoPause();
    });

    window.addEventListener('blur', handleAutoPause);

    document.addEventListener('keydown', (e) => {
        if (overlay.classList.contains('active')) return;
        if (isRoundFinished) return;
        if (isPaused) {
            // Allow space to unpause
            if (e.code === 'Space') { e.preventDefault(); togglePause(); }
            return;
        }

        if (e.key >= '1' && e.key <= '9') {
            const val = parseInt(e.key);
            if (flashIfCompleted(val)) return;
            setSelectedNumber(val); // highlight numpad
            if (isNotesMode) {
                inputNote(val);
            } else {
                inputNumber(val);
            }
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
            eraseCell();
        } else if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey)) {
            undoMove();
        } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            handleArrowNavigation(e.key);
        } else if (isAutoFillShortcut(e)) {
            // F / ` / ~ / Space / Esc: same as double-click on the selected empty cell
            e.preventDefault();
            applyShortcutInputToSelectedCell();
        }
    });

    // === Core UI & Logic Functions ===

    function initGame() {
        overlay.classList.remove('active');
        // Always resume if starting a new game while paused
        if (isPaused) {
            isPaused = false;
            pauseOverlay.classList.remove('active');
            pauseIcon.className = 'fas fa-pause';
        }
        // Reset notes mode
        isNotesMode = false;
        btnNotes.classList.remove('notes-active');
        clearSelectedNumber();
        notes = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => new Set()));

        mistakes = 0;
        isRoundFinished = false;
        updateMistakesDisplay();
        history = [];
        selectedCell = null;

        dailyDate = stats && difficultySelect.value === DAILY ? stats.today() : null;
        if (!dailyDate && difficultySelect.value === DAILY) difficultySelect.value = lastRegularDifficulty;
        const dailyState = dailyDate ? stats.daily.get() : null;
        dailyPractice = Boolean(dailyState && dailyState.cleared);

        resetTimer();
        if (dailyState && !dailyPractice) {
            secondsElapsed = dailyState.elapsed;
            timerEl.textContent = formatTime(secondsElapsed);
        }
        startTimer();

        generateSudoku();
        renderBoard();
        combo.reset();
        updateNumpadState();
        saveGame();
    }

    function togglePause() {
        if (isRoundFinished) return;
        if (overlay.classList.contains('active')) return;
        isPaused = !isPaused;
        if (isPaused) {
            clearInterval(timerInterval);
            pauseOverlay.classList.add('active');
            pauseIcon.className = 'fas fa-play';
        } else {
            startTimer();
            pauseOverlay.classList.remove('active');
            pauseIcon.className = 'fas fa-pause';
        }
    }

    function renderBoard() {
        boardElement.innerHTML = '';
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                const cell = document.createElement('div');
                cell.classList.add('cell');
                cell.dataset.row = r;
                cell.dataset.col = c;

                if (board[r][c] !== 0) {
                    cell.textContent = board[r][c];
                    if (initialBoard[r][c] === 0) {
                        cell.classList.add('user-input');
                    }
                }

                cell.addEventListener('click', () => {
                    selectCell(r, c);
                    // Clicking a cell with a number selects that number
                    const val = board[r][c];
                    if (val !== 0) {
                        setSelectedNumber(val);
                    }
                });
                // Double-click on an empty cell to auto-fill it, or place the selected number
                cell.addEventListener('dblclick', () => {
                    if (board[r][c] !== 0) return;        // already filled
                    if (initialBoard[r][c] !== 0) return; // initial clue
                    applyShortcutInputToCell(r, c);
                });
                boardElement.appendChild(cell);
            }
        }
    }

    function selectCell(r, c) {
        if (isRoundFinished) return;
        if (overlay.classList.contains('active')) return;

        selectedCell = { r, c };

        // Remove old highlights
        document.querySelectorAll('.cell').forEach(cell => {
            cell.classList.remove('selected', 'highlighted', 'same-number');
        });

        const targetCell = getCellElement(r, c);
        targetCell.classList.add('selected');

        syncSelectedNumberForCell(r, c);

        const cellValue = board[r][c];

        // Apply new highlights (row, col, block and matching numbers)
        for (let i = 0; i < 9; i++) {
            for (let j = 0; j < 9; j++) {
                const cellEl = getCellElement(i, j);

                // Highlight row, col, 3x3 block
                const isSameBlock = Math.floor(i / 3) === Math.floor(r / 3) && Math.floor(j / 3) === Math.floor(c / 3);
                if (i === r || j === c || isSameBlock) {
                    if (i !== r || j !== c) cellEl.classList.add('highlighted');
                }

                // Highlight same numbers
                if (cellValue !== 0 && board[i][j] === cellValue) {
                    cellEl.classList.add('same-number');
                }
            }
        }
    }

    function inputNumber(val) {
        if (!canPlay()) return;
        if (isNotesMode) {
            inputNote(val);
            return;
        }

        if (!selectedCell) return;
        const { r, c } = selectedCell;

        if (initialBoard[r][c] !== 0) return; // Cannot overwrite initial clues

        if (board[r][c] === val) { // Toggle off if same
            eraseCell();
            return;
        }

        // A placed number is always correct, so another number there is a typo: ignore it.
        if (board[r][c] !== 0) return;

        // Validate Input against Solution
        if (solution[r][c] === val) {
            // Correct logic — clear notes for this cell (kept in history so Undo brings them back)
            const removedNotes = [];
            if (notes[r][c].size > 0) removedNotes.push([r, c, [...notes[r][c]]]);
            notes[r][c].clear();
            board[r][c] = val;
            updateCellDOM(r, c, val, true);
            // Remove this number from notes of all related cells (row/col/box)
            removeNoteFromRelatedCells(r, c, val).forEach(([nr, nc]) => removedNotes.push([nr, nc, [val]]));
            saveHistory(r, c, 0, removedNotes);
            combo.onCorrect(r, c, val);
            emitFx('onCorrectInput', { r, c, val, units: getCompletedUnits(r, c) });
            updateNumpadState();
            selectCell(r, c);
            checkWin();
            saveGame();

        } else {
            // Incorrect logic
            mistakes++;
            updateMistakesDisplay();
            combo.onMistake();
            emitFx('onMistake', {
                r, c,
                bar: healthBars[MAX_MISTAKES - mistakes],
                livesLeft: MAX_MISTAKES - mistakes
            });

            const cellEl = getCellElement(r, c);
            cellEl.classList.add('error-animation');
            cellEl.textContent = val;

            setTimeout(() => {
                // A new game may have rebuilt the board in the meantime.
                if (!cellEl.isConnected) return;
                cellEl.classList.remove('error-animation');
                // Put the cell's notes back instead of leaving it blank.
                if (board[r][c] !== 0) cellEl.textContent = board[r][c];
                else renderCellNotes(r, c);
            }, 500);

            if (mistakes >= MAX_MISTAKES) gameOver(false);
            else saveGame();
        }
    }

    function eraseCell() {
        if (!canPlay()) return;
        if (!selectedCell) return;
        const { r, c } = selectedCell;
        if (initialBoard[r][c] !== 0) return;

        const prevVal = board[r][c];
        const clearedNotes = notes[r][c].size > 0 ? [[r, c, [...notes[r][c]]]] : [];
        // Erasing a number or notes can be undone.
        if (prevVal !== 0 || clearedNotes.length > 0) saveHistory(r, c, prevVal, clearedNotes);

        // If there's a placed number, erase it
        if (prevVal !== 0) {
            board[r][c] = 0;
            updateCellDOM(r, c, '', false);
            combo.onRemove(r, c);
        }
        // Always clear all draft notes
        if (notes[r][c].size > 0) {
            notes[r][c].clear();
            renderCellNotes(r, c);
        }
        selectCell(r, c);
        updateNumpadState();
        saveGame();
    }

    // === Notes Mode ===
    function inputNote(val) {
        if (!canPlay()) return;
        if (!selectedCell) return;
        const { r, c } = selectedCell;
        if (initialBoard[r][c] !== 0) return; // Can't note on initial clues
        if (board[r][c] !== 0) return;         // Can't note where a number is placed

        // Toggle: add if absent, remove if present
        if (notes[r][c].has(val)) {
            notes[r][c].delete(val);
        } else {
            notes[r][c].add(val);
        }
        renderCellNotes(r, c);
        saveGame();
    }

    function renderCellNotes(r, c) {
        const cellEl = getCellElement(r, c);
        if (!cellEl) return;
        cellEl.innerHTML = '';
        cellEl.textContent = '';

        const noteSet = notes[r][c];
        if (noteSet.size === 0) return;

        const grid = document.createElement('div');
        grid.className = 'cell-notes-grid';
        for (let n = 1; n <= 9; n++) {
            const span = document.createElement('span');
            span.className = 'cell-note-num';
            span.textContent = noteSet.has(n) ? n : '';
            grid.appendChild(span);
        }
        cellEl.appendChild(grid);
    }

    // When a number is confirmed in (r,c), remove it from notes of all
    // cells in the same row, column, and 3×3 box. Returns the cells that changed.
    function removeNoteFromRelatedCells(r, c, val) {
        const boxRowStart = Math.floor(r / 3) * 3;
        const boxColStart = Math.floor(c / 3) * 3;
        const changed = [];
        const removeAt = (nr, nc) => {
            if (!notes[nr][nc].has(val)) return;
            notes[nr][nc].delete(val);
            renderCellNotes(nr, nc);
            changed.push([nr, nc]);
        };

        for (let i = 0; i < 9; i++) {
            removeAt(r, i); // Same row
            removeAt(i, c); // Same column
        }
        // Same 3×3 box
        for (let br = boxRowStart; br < boxRowStart + 3; br++) {
            for (let bc = boxColStart; bc < boxColStart + 3; bc++) {
                removeAt(br, bc);
            }
        }
        return changed;
    }

    function undoMove() {
        if (!canPlay()) return;
        if (history.length === 0) return;

        const { r, c, prevVal, notes: removedNotes } = history.pop();
        if (board[r][c] !== 0) combo.onRemove(r, c);
        board[r][c] = prevVal;
        updateCellDOM(r, c, prevVal !== 0 ? prevVal : '', prevVal !== 0 && initialBoard[r][c] === 0);

        // Bring back the notes this move cleared (only on cells that are still empty).
        if (Array.isArray(removedNotes)) {
            removedNotes.forEach(([nr, nc, vals]) => {
                if (board[nr][nc] !== 0) return;
                vals.forEach(v => notes[nr][nc].add(v));
                renderCellNotes(nr, nc);
            });
        }

        selectCell(r, c);
        updateNumpadState();
        saveGame();
    }

    // removedNotes: [[r, c, [values]]] notes cleared by this move, restored on undo.
    function saveHistory(r, c, prevVal, removedNotes = []) {
        history.push({ r, c, prevVal, notes: removedNotes });
    }

    function updateCellDOM(r, c, val, isUserInput) {
        const cellEl = getCellElement(r, c);
        cellEl.textContent = val;

        // Trigger subtle animation
        cellEl.style.animation = 'none';
        void cellEl.offsetWidth; // Reflow
        cellEl.style.animation = 'popIn 0.2s ease-out';

        if (isUserInput) cellEl.classList.add('user-input');
        else cellEl.classList.remove('user-input');
    }

    function getCellElement(r, c) {
        return document.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
    }

    function updateMistakesDisplay() {
        // Rich effects use this to pulse the last remaining life.
        healthBarsEl.dataset.lives = String(MAX_MISTAKES - mistakes);
        healthBars.forEach((bar, index) => {
            if (index < (3 - mistakes)) {
                bar.classList.add('active');
            } else {
                bar.classList.remove('active');
            }
        });
    }

    // silent: skip the "number complete" celebration (e.g. when restoring a saved game).
    function updateNumpadState({ silent = false } = {}) {
        const counts = Array(10).fill(0);
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (board[r][c] !== 0) {
                    counts[board[r][c]]++;
                }
            }
        }

        numButtons.forEach(btn => {
            const val = parseInt(btn.getAttribute('data-val'));
            const wasDisabled = btn.classList.contains('disabled');
            // How many of this number are still missing (the rich effects glow the button at 1).
            btn.dataset.left = String(Math.max(0, 9 - counts[val]));

            if (counts[val] >= 9) {
                btn.classList.add('disabled');
                // Trigger celebration only when this number JUST became complete
                if (!wasDisabled && !silent) celebrateNumber(val, btn);
            } else {
                btn.classList.remove('disabled');
            }
        });
        if (selectedNumber !== null && counts[selectedNumber] >= 9) {
            clearSelectedNumber();
        } else if (selectedCell && board[selectedCell.r][selectedCell.c] === 0) {
            syncSelectedNumberForCell(selectedCell.r, selectedCell.c);
        } else {
            refreshSelectedNumberUI();
        }
        combo.syncCounts(counts);
    }

    // Cascade wave animation for a completed number
    function celebrateNumber(val, btnEl) {
        emitFx('onNumberComplete', { val, btn: btnEl });
        // Collect all cells with this number in board order (top-left to bottom-right)
        const cells = [];
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (board[r][c] === val) {
                    cells.push(getCellElement(r, c));
                }
            }
        }

        // Fire cascade: each cell gets a delayed animation
        cells.forEach((cellEl, idx) => {
            setTimeout(() => {
                if (!cellEl) return;
                cellEl.classList.remove('complete-flash');
                void cellEl.offsetWidth; // Reflow to restart animation
                cellEl.classList.add('complete-flash');
                setTimeout(() => cellEl.classList.remove('complete-flash'), 700);
            }, idx * 60); // 60ms between each cell
        });

        // Celebrate numpad button with a pop after the wave
        if (btnEl) {
            setTimeout(() => {
                btnEl.classList.add('completing');
                setTimeout(() => btnEl.classList.remove('completing'), 800);
            }, cells.length * 60 + 50);
        }
    }



    function checkWin() {
        let isComplete = true;
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (board[r][c] !== solution[r][c]) {
                    isComplete = false;
                    break;
                }
            }
        }
        if (isComplete) gameOver(true);
    }

    function gameOver(isWin) {
        clearInterval(timerInterval);
        saveDailyElapsed();
        isRoundFinished = true;
        clearSavedGame();
        isPaused = false;
        pauseOverlay.classList.remove('active');
        pauseIcon.className = 'fas fa-pause';
        overlayContent.classList.remove('win-state', 'error-state');
        if (overlayStats) overlayStats.replaceChildren();

        if (isWin) {
            emitFx('onWin');
            overlayContent.classList.add('win-state');
            overlayTitle.textContent = "완벽한 마무리";
            overlayTitle.className = "";
            const comboOn = combo.isEnabled();
            if (comboOn) combo.finishRound();
            const score = comboOn ? combo.getScore() : null;

            if (dailyDate) {
                const [, month, day] = dailyDate.split('-');
                overlayKicker.textContent = `오늘의 퍼즐 · ${Number(month)}월 ${Number(day)}일`;
            } else {
                overlayKicker.textContent = "퍼즐 완성";
            }
            overlayMsg.textContent = dailyPractice
                ? "연습으로 다시 풀었어요.\n오늘의 기록은 첫 클리어만 남습니다."
                : "";
            overlayBtn.textContent = "새 퍼즐 시작";
            showWinStats(score);

            // Record for the TOP 10 check (leaderboard.js); captured now, before anything resets.
            // The daily puzzle has its own board; a replay of it is never sent.
            const record = dailyDate
                ? { mode: DAILY, difficulty: 'medium', date: dailyDate, time: secondsElapsed, mistakes, score: null }
                : { mode: comboOn ? 'combo' : 'normal', difficulty: difficultySelect.value, time: secondsElapsed, mistakes, score };
            const submit = !dailyPractice;
            // Play win cascade then show overlay
            celebrateAllNumbers(() => {
                overlay.classList.add('active');
                if (submit && window.Leaderboard) window.Leaderboard.onWin(record);
            });
        } else {
            overlayContent.classList.add('error-state');
            overlayKicker.textContent = "도전 종료";
            overlayTitle.textContent = "한 번 더 도전해보세요";
            overlayTitle.className = "error-title";
            overlayMsg.textContent = "실수 3회를 모두 사용했습니다.\n새 게임으로 바로 다시 시작할 수 있습니다.";
            overlayBtn.textContent = "새 게임 시작";
            overlay.classList.add('active');
        }
    }

    // Result popup: this game's numbers next to the personal bests (stats.js).
    function showWinStats(score) {
        if (!overlayStats) return;
        const comboOn = score !== null;
        const rows = [];
        const addRow = (label, value, note = '', isNew = false) => rows.push({ label, value, note, isNew });

        let result = null;
        let streak = 0;
        if (stats && !dailyPractice) {
            const key = dailyDate ? DAILY : `${comboOn ? 'combo' : 'normal'}-${difficultySelect.value}`;
            // The daily puzzle keeps time only; combo score there is just for fun.
            result = stats.recordWin(key, { time: secondsElapsed, score: dailyDate ? null : score });
            if (dailyDate) streak = stats.daily.markCleared(secondsElapsed);
        }

        const bestNote = (isBest, prev, format) => {
            if (!result || result.first) return '';
            return isBest ? '개인 최고!' : `최고 ${format(prev)}`;
        };
        addRow('시간', formatTime(secondsElapsed),
            bestNote(result && result.isBestTime, result && result.prevBestTime, formatTime),
            Boolean(result && result.isBestTime && !result.first));
        addRow('실수', `${mistakes}/${MAX_MISTAKES}`, mistakes === 0 ? '노미스' : '');
        if (comboOn) {
            const tracked = !dailyDate;
            addRow('콤보 점수', `${score.toLocaleString()}점`,
                tracked ? bestNote(result && result.isBestScore, result && result.prevBestScore, (v) => `${v.toLocaleString()}점`) : '',
                Boolean(tracked && result && result.isBestScore && !result.first));
            const bestHand = typeof combo.getBestHand === 'function' ? combo.getBestHand() : null;
            if (bestHand) addRow('최고 족보', bestHand.name, `${bestHand.points}점`);
        }
        if (result) {
            const where = dailyDate ? '오늘의 퍼즐' : `${comboOn ? '콤보 ' : ''}${DIFFICULTY_LABEL[difficultySelect.value] || ''}`;
            addRow('클리어', `${result.wins}번째`, where);
        }
        if (streak > 0) addRow('연속 출석', `${streak}일`, streak > 1 ? '🔥 이어가는 중' : '오늘부터 시작');

        rows.forEach(({ label, value, note, isNew }) => {
            const row = document.createElement('div');
            row.className = 'result-stat' + (isNew ? ' is-new' : '');
            const labelEl = document.createElement('span');
            labelEl.className = 'result-stat-label';
            labelEl.textContent = label;
            const valueEl = document.createElement('strong');
            valueEl.textContent = value;
            const noteEl = document.createElement('em');
            noteEl.textContent = note;
            row.append(labelEl, valueEl, noteEl);
            overlayStats.appendChild(row);
        });
    }

    // Cascade all 9 numbers in sequence at win, then call callback
    function celebrateAllNumbers(callback) {
        const WAVE_DURATION = 65;    // ms per cell
        const GROUP_DELAY = 120;     // ms between starting each number group

        let totalDelay = 0;
        for (let num = 1; num <= 9; num++) {
            const cells = [];
            for (let r = 0; r < 9; r++)
                for (let c = 0; c < 9; c++)
                    if (board[r][c] === num) cells.push(getCellElement(r, c));

            const numStartDelay = totalDelay;
            cells.forEach((cellEl, idx) => {
                setTimeout(() => {
                    if (!cellEl) return;
                    cellEl.classList.remove('complete-flash');
                    void cellEl.offsetWidth;
                    cellEl.classList.add('complete-flash');
                    setTimeout(() => cellEl.classList.remove('complete-flash'), 700);
                }, numStartDelay + idx * WAVE_DURATION);
            });

            // Also flash numpad button
            const btn = document.querySelector(`.num-btn[data-val="${num}"]`);
            if (btn) {
                setTimeout(() => {
                    btn.classList.add('completing');
                    setTimeout(() => btn.classList.remove('completing'), 700);
                }, numStartDelay);
            }

            totalDelay += GROUP_DELAY;
        }

        // Show overlay after all animations finish
        setTimeout(callback, totalDelay + 700);
    }

    function handleArrowNavigation(key) {
        if (!selectedCell) {
            selectCell(0, 0);
            return;
        }
        let { r, c } = selectedCell;

        if (key === 'ArrowUp') r = Math.max(0, r - 1);
        else if (key === 'ArrowDown') r = Math.min(8, r + 1);
        else if (key === 'ArrowLeft') c = Math.max(0, c - 1);
        else if (key === 'ArrowRight') c = Math.min(8, c + 1);

        selectCell(r, c);
    }

    // === Timer ===
    function startTimer() {
        timerInterval = setInterval(() => {
            secondsElapsed++;
            timerEl.textContent = formatTime(secondsElapsed);
            if (secondsElapsed % 5 === 0) saveGame();
        }, 1000);
    }

    function resetTimer() {
        clearInterval(timerInterval);
        secondsElapsed = 0;
        timerEl.textContent = "00:00";
    }

    function formatTime(totalSeconds) {
        const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
        const s = (totalSeconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    }

    function getDifficultySettings() {
        return DIFFICULTY_SETTINGS[difficultySelect.value] || DIFFICULTY_SETTINGS.medium;
    }

    function applyGeneratedPuzzle(generated) {
        solution = generated.solution;
        board = generated.puzzle;
        initialBoard = JSON.parse(JSON.stringify(board));
    }

    function tryGeneratePuzzle(cluesTarget, maxAttempts) {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const sol = Array(9).fill(null).map(() => Array(9).fill(0));
            fillDiagonal(sol);
            solveSudoku(sol);

            const puzzle = JSON.parse(JSON.stringify(sol));
            const positions = shuffleArray([...Array(81).keys()]);
            let cluesLeft = 81;

            for (const pos of positions) {
                if (cluesLeft <= cluesTarget) break;
                const r = Math.floor(pos / 9);
                const c = pos % 9;
                if (puzzle[r][c] === 0) continue;

                const backup = puzzle[r][c];
                puzzle[r][c] = 0;

                // Only remove if solution remains unique
                if (countSolutions(puzzle) === 1) {
                    cluesLeft--;
                } else {
                    puzzle[r][c] = backup; // Restore if not unique
                }
            }

            if (cluesLeft !== cluesTarget) continue;
            if (!isLogicallySolvable(puzzle)) continue;

            return { solution: sol, puzzle };
        }

        return null;
    }

    // === Sudoku Generator Engine (Backtracking + Logic Validation) ===
    function generateSudoku() {
        if (!dailyDate) {
            buildPuzzle();
            return;
        }
        // Same date -> same random sequence -> same puzzle on every device.
        rand = seededRandom(dailyDate);
        try {
            buildPuzzle();
        } finally {
            rand = Math.random;
        }
    }

    // Deterministic generator (mulberry32) seeded from a string.
    function seededRandom(text) {
        let seed = 2166136261;
        for (let i = 0; i < text.length; i++) {
            seed ^= text.charCodeAt(i);
            seed = Math.imul(seed, 16777619);
        }
        return () => {
            seed = (seed + 0x6D2B79F5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function buildPuzzle() {
        const settings = getDifficultySettings();

        for (const cluesTarget of settings.fallbackTargets) {
            const generated = tryGeneratePuzzle(cluesTarget, settings.maxAttempts);
            if (generated) {
                applyGeneratedPuzzle(generated);
                return;
            }
        }

        // Keep generating only validated puzzles rather than falling back to random removals.
        const safestTarget = settings.fallbackTargets[settings.fallbackTargets.length - 1];
        let generated = null;
        while (!generated) {
            generated = tryGeneratePuzzle(safestTarget, settings.maxAttempts);
        }
        applyGeneratedPuzzle(generated);
    }

    // Shuffle an array (Fisher-Yates)
    function shuffleArray(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    // Count solutions (stops at 2 for efficiency)
    function countSolutions(mat) {
        const copy = mat.map(r => [...r]);
        let count = 0;
        function solve() {
            for (let r = 0; r < 9; r++) {
                for (let c = 0; c < 9; c++) {
                    if (copy[r][c] === 0) {
                        for (let v = 1; v <= 9; v++) {
                            if (isSafeBoard(copy, r, c, v)) {
                                copy[r][c] = v;
                                solve();
                                copy[r][c] = 0;
                                if (count >= 2) return;
                            }
                        }
                        return;
                    }
                }
            }
            count++;
        }
        solve();
        return count;
    }

    // ===== Logic-Only Solver =====
    // Returns true if the puzzle can be fully solved using:
    //   1. Naked Singles   (only one candidate in a cell)
    //   2. Hidden Singles  (only one cell in a unit can hold a value)
    //   3. Naked Pairs     (two cells in a unit share exactly two candidates)
    function isLogicallySolvable(puzzle) {
        // Deep copy to work on
        const grid = puzzle.map(r => [...r]);

        // Build candidate sets for each cell
        const candidates = Array.from({ length: 9 }, (_, r) =>
            Array.from({ length: 9 }, (__, c) => {
                if (grid[r][c] !== 0) return new Set();
                const possible = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]);
                // Eliminate by row
                for (let k = 0; k < 9; k++) if (grid[r][k]) possible.delete(grid[r][k]);
                // Eliminate by col
                for (let k = 0; k < 9; k++) if (grid[k][c]) possible.delete(grid[k][c]);
                // Eliminate by box
                const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
                for (let dr = 0; dr < 3; dr++)
                    for (let dc = 0; dc < 3; dc++)
                        if (grid[br + dr][bc + dc]) possible.delete(grid[br + dr][bc + dc]);
                return possible;
            })
        );

        const units = getUnits();
        let progress = true;
        while (progress) {
            progress = false;

            // --- Naked Singles ---
            for (let r = 0; r < 9; r++) {
                for (let c = 0; c < 9; c++) {
                    if (grid[r][c] !== 0) continue;
                    if (candidates[r][c].size === 1) {
                        const val = [...candidates[r][c]][0];
                        grid[r][c] = val;
                        eliminateFromPeers(candidates, grid, r, c, val);
                        progress = true;
                    } else if (candidates[r][c].size === 0) {
                        return false; // Contradiction
                    }
                }
            }

            // --- Hidden Singles (check each unit) ---
            for (const unit of units) {
                for (let val = 1; val <= 9; val++) {
                    const possibleCells = unit.filter(([r, c]) => candidates[r][c].has(val));
                    if (possibleCells.length === 1) {
                        const [r, c] = possibleCells[0];
                        if (grid[r][c] === 0) {
                            grid[r][c] = val;
                            candidates[r][c] = new Set();
                            eliminateFromPeers(candidates, grid, r, c, val);
                            progress = true;
                        }
                    } else if (possibleCells.length === 0) {
                        // Check if val is still needed in the unit
                        const alreadyPlaced = unit.some(([r, c]) => grid[r][c] === val);
                        if (!alreadyPlaced) return false;
                    }
                }
            }

            // --- Naked Pairs ---
            for (const unit of units) {
                const emptyCells = unit.filter(([r, c]) => grid[r][c] === 0);
                for (let i = 0; i < emptyCells.length; i++) {
                    const [r1, c1] = emptyCells[i];
                    if (candidates[r1][c1].size !== 2) continue;
                    for (let j = i + 1; j < emptyCells.length; j++) {
                        const [r2, c2] = emptyCells[j];
                        if (candidates[r2][c2].size !== 2) continue;
                        const s1 = [...candidates[r1][c1]].sort().join(',');
                        const s2 = [...candidates[r2][c2]].sort().join(',');
                        if (s1 === s2) {
                            // Found a naked pair — eliminate these two values from all other cells in unit
                            const pairVals = candidates[r1][c1];
                            for (const [r3, c3] of emptyCells) {
                                if ((r3 === r1 && c3 === c1) || (r3 === r2 && c3 === c2)) continue;
                                for (const pv of pairVals) {
                                    if (candidates[r3][c3].delete(pv)) progress = true;
                                }
                            }
                        }
                    }
                }
            }
        }

        // Check if fully solved
        return grid.every(row => row.every(v => v !== 0));
    }

    function eliminateFromPeers(candidates, grid, r, c, val) {
        // Row
        for (let k = 0; k < 9; k++) candidates[r][k].delete(val);
        // Col
        for (let k = 0; k < 9; k++) candidates[k][c].delete(val);
        // Box
        const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
        for (let dr = 0; dr < 3; dr++)
            for (let dc = 0; dc < 3; dc++)
                candidates[br + dr][bc + dc].delete(val);
    }

    function getUnits() {
        const units = [];
        // Rows
        for (let r = 0; r < 9; r++) units.push(Array.from({ length: 9 }, (_, c) => [r, c]));
        // Cols
        for (let c = 0; c < 9; c++) units.push(Array.from({ length: 9 }, (_, r) => [r, c]));
        // Boxes
        for (let br = 0; br < 3; br++)
            for (let bc = 0; bc < 3; bc++) {
                const box = [];
                for (let dr = 0; dr < 3; dr++)
                    for (let dc = 0; dc < 3; dc++)
                        box.push([br * 3 + dr, bc * 3 + dc]);
                units.push(box);
            }
        return units;
    }

    function fillDiagonal(mat) {
        for (let i = 0; i < 9; i += 3) fillBox(mat, i, i);
    }

    function fillBox(mat, rowStart, colStart) {
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                let num;
                do { num = Math.floor(rand() * 9) + 1; }
                while (!isSafeInBox(mat, rowStart, colStart, num));
                mat[rowStart + i][colStart + j] = num;
            }
        }
    }

    function isSafeInBox(mat, rowStart, colStart, num) {
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                if (mat[rowStart + i][colStart + j] === num) return false;
            }
        }
        return true;
    }

    function isSafeBoard(mat, i, j, num) {
        for (let k = 0; k < 9; k++) if (mat[i][k] === num) return false;
        for (let k = 0; k < 9; k++) if (mat[k][j] === num) return false;
        let rStart = i - i % 3;
        let cStart = j - j % 3;
        return isSafeInBox(mat, rStart, cStart, num);
    }

    function solveSudoku(mat) {
        for (let i = 0; i < 9; i++) {
            for (let j = 0; j < 9; j++) {
                if (mat[i][j] === 0) {
                    for (let val = 1; val <= 9; val++) {
                        if (isSafeBoard(mat, i, j, val)) {
                            mat[i][j] = val;
                            if (solveSudoku(mat)) return true;
                            mat[i][j] = 0;
                        }
                    }
                    return false;
                }
            }
        }
        return true;
    }
});
