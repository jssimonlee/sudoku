document.addEventListener('DOMContentLoaded', () => {
    // === Game State ===
    let board = [];
    let initialBoard = [];
    let solution = [];
    let selectedCell = null;
    let mistakes = 0;
    const MAX_MISTAKES = 3;
    let history = [];

    let timerInterval;
    let secondsElapsed = 0;

    // === DOM Elements ===
    const boardElement = document.getElementById('sudoku-board');
    const mistakeCountEl = document.getElementById('mistake-count');
    const timerEl = document.getElementById('timer');
    const difficultySelect = document.getElementById('difficulty');

    const numButtons = document.querySelectorAll('.num-btn');
    const btnUndo = document.getElementById('btn-undo');
    const btnErase = document.getElementById('btn-erase');
    const btnHint = document.getElementById('btn-hint');
    const btnNewGame = document.getElementById('btn-new-game');

    const overlay = document.getElementById('game-overlay');
    const overlayTitle = document.getElementById('overlay-title');
    const overlayMsg = document.getElementById('overlay-msg');
    const overlayBtn = document.getElementById('overlay-btn');

    const themeToggleBtn = document.getElementById('theme-toggle');
    const themeIcon = document.getElementById('theme-icon');

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
    btnHint.addEventListener('click', giveHint);

    numButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('disabled')) return;
            const val = parseInt(btn.getAttribute('data-val'));
            inputNumber(val);
        });
    });

    document.addEventListener('keydown', (e) => {
        if (overlay.classList.contains('active')) return;

        if (e.key >= '1' && e.key <= '9') {
            inputNumber(parseInt(e.key));
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
            eraseCell();
        } else if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey)) {
            undoMove();
        } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            handleArrowNavigation(e.key);
        }
    });

    // === Core UI & Logic Functions ===

    function initGame() {
        overlay.classList.remove('active');
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

                cell.addEventListener('click', () => selectCell(r, c));
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
            // Correct logic
            saveHistory(r, c, board[r][c]);
            board[r][c] = val;
            updateCellDOM(r, c, val, true);
            selectCell(r, c); // Refresh highlights
            updateNumpadState();
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
        if (board[r][c] === 0) return;

        saveHistory(r, c, board[r][c]);
        board[r][c] = 0;
        updateCellDOM(r, c, '', false);
        selectCell(r, c);
        updateNumpadState();
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
        mistakeCountEl.textContent = mistakes;
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
            const wasDisabled = btn.classList.contains('disabled');

            if (counts[val] >= 9) {
                btn.classList.add('disabled');
                // Trigger celebration only when this number JUST became complete
                if (!wasDisabled) {
                    celebrateNumber(val, btn);
                }
            } else {
                btn.classList.remove('disabled');
            }
        });
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
                setTimeout(() => cellEl.classList.remove('complete-flash'), 800);
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
        overlay.classList.add('active');

        if (isWin) {
            overlayTitle.textContent = "Excellent!";
            overlayTitle.className = "";
            let timeStr = formatTime(secondsElapsed);
            overlayMsg.textContent = `You solved the puzzle in ${timeStr} with ${mistakes}/3 mistakes.`;
        } else {
            overlayTitle.textContent = "Game Over!";
            overlayTitle.className = "error-title";
            overlayMsg.textContent = "You made 3 mistakes. Try again!";
        }
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

    // === Sudoku Generator Engine (Backtracking + Logic Validation) ===
    function generateSudoku() {
        const diff = difficultySelect.value;
        // Number of clues to KEEP (easy = more clues, hard = fewer)
        const cluesTarget = diff === 'easy' ? 51 : diff === 'hard' ? 31 : 41;
        const maxAttempts = 40;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            // 1. Generate a fresh full solved board
            const sol = Array(9).fill(null).map(() => Array(9).fill(0));
            fillDiagonal(sol);
            solveSudoku(sol);

            // 2. Remove cells ensuring unique solution at each step
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

            // 3. Validate: can this puzzle be solved with LOGIC ONLY (no guessing)?
            if (isLogicallySolvable(puzzle)) {
                solution = sol;
                board = puzzle;
                initialBoard = JSON.parse(JSON.stringify(board));
                return; // Success
            }
        }

        // Fallback: If no logic-only puzzle found after maxAttempts, use best we have
        // (rare edge case, shouldn't happen often)
        const sol = Array(9).fill(null).map(() => Array(9).fill(0));
        fillDiagonal(sol);
        solveSudoku(sol);
        solution = sol;
        board = JSON.parse(JSON.stringify(sol));
        const diff2 = difficultySelect.value;
        let cellsToRemove = diff2 === 'easy' ? 30 : diff2 === 'hard' ? 50 : 40;
        while (cellsToRemove > 0) {
            let i = Math.floor(Math.random() * 9);
            let j = Math.floor(Math.random() * 9);
            if (board[i][j] !== 0) { board[i][j] = 0; cellsToRemove--; }
        }
        initialBoard = JSON.parse(JSON.stringify(board));
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
            const units = getUnits();
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
