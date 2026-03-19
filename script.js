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
    let isGreenComplete = false;
    let isNotesMode = false;
    let notes = [];
    let selectedNumber = null; // Currently active number for quick entry
    let selectedNumberSource = null; // 'user' | 'auto'

    let timerInterval;
    let secondsElapsed = 0;

    // === DOM Elements ===
    const boardElement = document.getElementById('sudoku-board');
    const healthBars = document.querySelectorAll('.health-bar');
    const timerEl = document.getElementById('timer');
    const difficultySelect = document.getElementById('difficulty');
    const DIFFICULTY_SETTINGS = {
        easy: { cluesTarget: 51, maxAttempts: 25, fallbackTargets: [51, 52, 53] },
        medium: { cluesTarget: 41, maxAttempts: 35, fallbackTargets: [41, 42, 43] },
        hard: { cluesTarget: 31, maxAttempts: 45, fallbackTargets: [31, 32, 33] },
        expert: { cluesTarget: 27, maxAttempts: 60, fallbackTargets: [27, 28, 29, 30] }
    };

    const numButtons = document.querySelectorAll('.num-btn');
    const btnUndo = document.getElementById('btn-undo');
    const btnErase = document.getElementById('btn-erase');
    const btnNotes = document.getElementById('btn-notes');
    const btnPause = document.getElementById('btn-pause');
    const pauseIcon = document.getElementById('pause-icon');
    const btnNewGame = document.getElementById('btn-new-game');

    const overlay = document.getElementById('game-overlay');
    const overlayTitle = document.getElementById('overlay-title');
    const overlayMsg = document.getElementById('overlay-msg');
    const overlayBtn = document.getElementById('overlay-btn');
    const pauseOverlay = document.getElementById('pause-overlay');
    const pauseResumeBtn = document.getElementById('pause-resume-btn');

    const themeToggleBtn = document.getElementById('theme-toggle');
    const themeIcon = document.getElementById('theme-icon');
    const completeColorToggleBtn = document.getElementById('complete-color-toggle');

    // === Init Game ===
    initTheme();
    initGame();

    function initTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        if (!currentTheme) {
            // Default to light theme
            document.documentElement.setAttribute('data-theme', 'light');
            themeIcon.className = 'fas fa-moon';
        }
    }

    // === Event Listeners ===
    themeToggleBtn.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        if (currentTheme === 'light') {
            document.documentElement.setAttribute('data-theme', 'dark');
            themeIcon.className = 'fas fa-sun theme-sun';
        } else {
            document.documentElement.setAttribute('data-theme', 'light');
            themeIcon.className = 'fas fa-moon';
        }
    });

    difficultySelect.addEventListener('change', initGame);
    btnNewGame.addEventListener('click', initGame);
    overlayBtn.addEventListener('click', initGame);

    btnUndo.addEventListener('click', undoMove);
    btnErase.addEventListener('click', eraseCell);
    btnPause.addEventListener('click', togglePause);
    pauseResumeBtn.addEventListener('click', togglePause);

    btnNotes.addEventListener('click', () => {
        isNotesMode = !isNotesMode;
        btnNotes.classList.toggle('notes-active', isNotesMode);
    });

    completeColorToggleBtn.addEventListener('click', () => {
        isGreenComplete = !isGreenComplete;

        if (isGreenComplete) {
            // Feature ON: button becomes colorless, numbers turn green
            completeColorToggleBtn.classList.remove('complete-color-on');
            updateNumpadState(); // handles numpad buttons

            // Also apply green to board cells of already-completed numbers
            const counts = Array(10).fill(0);
            for (let r = 0; r < 9; r++)
                for (let c = 0; c < 9; c++)
                    if (board[r][c] !== 0) counts[board[r][c]]++;

            for (let num = 1; num <= 9; num++) {
                if (counts[num] >= 9) {
                    for (let r = 0; r < 9; r++)
                        for (let c = 0; c < 9; c++)
                            if (board[r][c] === num) {
                                const el = getCellElement(r, c);
                                if (el) el.classList.add('cell-complete');
                            }
                }
            }
        } else {
            // Feature OFF: button becomes green, remove green, restore disabled style
            completeColorToggleBtn.classList.add('complete-color-on');
            document.querySelectorAll('.cell.cell-complete').forEach(el => el.classList.remove('cell-complete'));
            document.querySelectorAll('.num-btn.completed').forEach(el => {
                el.classList.remove('completed');
                el.classList.add('disabled'); // restore old disabled gray style
            });
        }
    });


    numButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('completed') || btn.classList.contains('disabled')) return;
            const val = parseInt(btn.getAttribute('data-val'));
            setSelectedNumber(val); // Mark this number as active
            if (isNotesMode) {
                inputNote(val);
            } else {
                inputNumber(val);
            }
        });
    });

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

    function getCellCandidates(r, c) {
        if (board[r][c] !== 0 || initialBoard[r][c] !== 0) return [];

        const candidates = [];
        for (let val = 1; val <= 9; val++) {
            if (isSafeBoard(board, r, c, val)) {
                candidates.push(val);
            }
        }
        return candidates;
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

        const unitCompletionVal = getLastUnitCompletionNumber(r, c);
        if (unitCompletionVal !== null) return unitCompletionVal;

        const candidates = getCellCandidates(r, c);
        if (candidates.length === 1) return candidates[0];

        return getOnlyRemainingNumber();
    }

    function syncSelectedNumberForCell(r, c) {
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
        if (board[r][c] !== 0 || initialBoard[r][c] !== 0) return false;

        selectCell(r, c);

        const autoVal = getAutoFillNumber(r, c);
        if (autoVal !== null) {
            inputNumber(autoVal);
            setSelectedNumber(autoVal);
            return true;
        }

        if (selectedNumber === null) return false;

        if (isNotesMode) {
            inputNote(selectedNumber);
        } else {
            inputNumber(selectedNumber);
        }

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
        if (isPaused) {
            // Allow space to unpause
            if (e.code === 'Space') { e.preventDefault(); togglePause(); }
            return;
        }

        if (e.key >= '1' && e.key <= '9') {
            const val = parseInt(e.key);
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
        updateMistakesDisplay();
        history = [];
        selectedCell = null;

        resetTimer();
        startTimer();

        generateSudoku();
        renderBoard();
        updateNumpadState();
    }

    function togglePause() {
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
        if (!selectedCell) return;
        const { r, c } = selectedCell;

        if (initialBoard[r][c] !== 0) return; // Cannot overwrite initial clues

        if (board[r][c] === val) { // Toggle off if same
            eraseCell();
            return;
        }

        // Validate Input against Solution
        if (solution[r][c] === val) {
            // Correct logic — clear notes for this cell
            notes[r][c].clear();
            saveHistory(r, c, board[r][c]);
            board[r][c] = val;
            updateCellDOM(r, c, val, true);
            // Remove this number from notes of all related cells (row/col/box)
            removeNoteFromRelatedCells(r, c, val);
            updateNumpadState();
            selectCell(r, c);
            checkWin();

        } else {
            // Incorrect logic
            mistakes++;
            updateMistakesDisplay();

            const cellEl = getCellElement(r, c);
            cellEl.classList.add('error-animation');
            cellEl.textContent = val;

            setTimeout(() => {
                cellEl.classList.remove('error-animation');
                cellEl.textContent = board[r][c] !== 0 ? board[r][c] : '';
            }, 500);

            if (mistakes >= MAX_MISTAKES) gameOver(false);
        }
    }

    function eraseCell() {
        if (!selectedCell) return;
        const { r, c } = selectedCell;
        if (initialBoard[r][c] !== 0) return;

        // If there's a placed number, erase it
        if (board[r][c] !== 0) {
            saveHistory(r, c, board[r][c]);
            board[r][c] = 0;
            updateCellDOM(r, c, '', false);
        }
        // Always clear all draft notes
        if (notes[r][c].size > 0) {
            notes[r][c].clear();
            renderCellNotes(r, c);
        }
        selectCell(r, c);
        updateNumpadState();
    }

    // === Notes Mode ===
    function inputNote(val) {
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
    // cells in the same row, column, and 3×3 box
    function removeNoteFromRelatedCells(r, c, val) {
        const boxRowStart = Math.floor(r / 3) * 3;
        const boxColStart = Math.floor(c / 3) * 3;

        for (let i = 0; i < 9; i++) {
            // Same row
            if (notes[r][i].has(val)) {
                notes[r][i].delete(val);
                renderCellNotes(r, i);
            }
            // Same column
            if (notes[i][c].has(val)) {
                notes[i][c].delete(val);
                renderCellNotes(i, c);
            }
        }
        // Same 3×3 box
        for (let br = boxRowStart; br < boxRowStart + 3; br++) {
            for (let bc = boxColStart; bc < boxColStart + 3; bc++) {
                if (notes[br][bc].has(val)) {
                    notes[br][bc].delete(val);
                    renderCellNotes(br, bc);
                }
            }
        }
    }



    function undoMove() {
        if (history.length === 0) return;

        const { r, c, prevVal } = history.pop();
        board[r][c] = prevVal;
        updateCellDOM(r, c, prevVal !== 0 ? prevVal : '', prevVal !== 0 && initialBoard[r][c] === 0);
        selectCell(r, c);
        updateNumpadState();
    }

    function giveHint() {
        if (!selectedCell) return;
        const { r, c } = selectedCell;
        if (board[r][c] !== 0) return; // Only hint empty cells

        inputNumber(solution[r][c]);
    }

    function saveHistory(r, c, prevVal) {
        history.push({ r, c, prevVal });
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
        healthBars.forEach((bar, index) => {
            if (index < (3 - mistakes)) {
                bar.classList.add('active');
            } else {
                bar.classList.remove('active');
            }
        });
    }

    function updateNumpadState() {
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
            const wasCompleted = btn.classList.contains('completed');
            const wasDisabled = btn.classList.contains('disabled');

            if (counts[val] >= 9) {
                if (isGreenComplete) {
                    // Green mode: use green completed style
                    btn.classList.add('completed');
                    btn.classList.remove('disabled');
                } else {
                    // Normal mode: use old gray disabled style
                    btn.classList.add('disabled');
                    btn.classList.remove('completed');
                }
                // Trigger celebration only when this number JUST became complete
                if (!wasCompleted && !wasDisabled) {
                    celebrateNumber(val, btn);
                }
            } else {
                btn.classList.remove('completed');
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
    }

    // Cascade wave animation for a completed number
    function celebrateNumber(val, btnEl) {
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
                setTimeout(() => {
                    cellEl.classList.remove('complete-flash');
                    // Permanently colour the cell green after animation (if toggle is ON)
                    if (isGreenComplete) cellEl.classList.add('cell-complete');
                }, 700);
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

        if (isWin) {
            overlayTitle.textContent = "Excellent!";
            overlayTitle.className = "";
            const timeStr = formatTime(secondsElapsed);
            overlayMsg.textContent = `You solved the puzzle in ${timeStr} with ${mistakes}/3 mistakes.`;
            // Play win cascade then show overlay
            celebrateAllNumbers(() => {
                overlay.classList.add('active');
            });
        } else {
            overlayTitle.textContent = "Game Over!";
            overlayTitle.className = "error-title";
            overlayMsg.textContent = "You made 3 mistakes. Try again!";
            overlay.classList.add('active');
        }
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
            const j = Math.floor(Math.random() * (i + 1));
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
                do { num = Math.floor(Math.random() * 9) + 1; }
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
