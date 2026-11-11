// TOP 10 leaderboard server settings.
// apiBase: the deployed Worker URL (no trailing slash). Empty = leaderboard off,
//          the game then works exactly as before and never calls the network.
// turnstileSiteKey: optional Cloudflare Turnstile site key. Set it only together
//          with the Worker's TURNSTILE_SECRET secret.
window.SUDOKU_LEADERBOARD_CONFIG = {
    apiBase: 'https://sudoku-api.jssimonlee.workers.dev',
    turnstileSiteKey: ''
};
