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
    initGame();

    // === Event Listeners ===
    themeToggleBtn.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        if (currentTheme === 'light') {
            document.documentElement.removeAttribute('data-theme');
            themeIcon.className = 'fas fa-sun';
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
            if (counts[val] >= 9) {
                btn.classList.add('disabled');
            } else {
                btn.classList.remove('disabled');
            }
        });
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

    // === Sudoku Generator Engine (Backtracking) ===
    function generateSudoku() {
        // 1. Generate full solved board
        solution = Array(9).fill(null).map(() => Array(9).fill(0));
        fillDiagonal(solution);
        solveSudoku(solution);

        // 2. Erase numbers based on difficulty
        board = JSON.parse(JSON.stringify(solution));
        const diff = difficultySelect.value;
        let cellsToRemove = diff === 'easy' ? 30 : diff === 'hard' ? 50 : 40;

        while (cellsToRemove > 0) {
            let i = Math.floor(Math.random() * 9);
            let j = Math.floor(Math.random() * 9);
            if (board[i][j] !== 0) {
                board[i][j] = 0;
                cellsToRemove--;
            }
        }

        initialBoard = JSON.parse(JSON.stringify(board));
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
