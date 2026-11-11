// Sudoku TOP 10 leaderboard API (Cloudflare Worker + D1).
//
//   GET  /leaderboards  -> all 12 boards (top 10 each) in one response
//   POST /submit        -> { mode, difficulty, time, mistakes, score, initials, turnstileToken? }
//
// Boards: normal-<d>, combo-time-<d>, combo-score-<d> for d in easy|medium|hard|expert,
// plus daily-<YYYY-MM-DD>: the daily puzzle (same board for everyone, ranked by time).
// Only today's daily board is served and accepts records; the day changes at midnight KST.
// The client only submits when its cached boards say the record makes the top 10;
// the Worker always re-checks against the live data, so the cache is never trusted.

const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'];
const KINDS = ['normal', 'combo-time', 'combo-score'];
const TOP_N = 10;
const DAILY = 'daily';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// Plausibility limits. A puzzle can't be solved faster than this (seconds).
const MIN_TIME = { easy: 30, medium: 45, hard: 60, expert: 75 };
const MAX_TIME = 24 * 60 * 60;
// Most empty cells per difficulty (81 - fewest clues) × best points per card
// (five of a kind: 250 points / 5 cards) = highest possible combo score.
const MAX_EMPTY_CELLS = { easy: 30, medium: 40, hard: 50, expert: 54 };
const MAX_POINTS_PER_CELL = 50;
const MAX_MISTAKES = 2; // a third mistake ends the game

const INITIALS_RE = /^[A-Z0-9]{3}$/;
const BLOCKED_INITIALS = new Set([
    'ASS', 'CUM', 'DIC', 'DIK', 'FAG', 'FCK', 'FUC', 'FUK', 'KKK', 'NIG', 'SEX', 'SHT', 'TIT', 'XXX', 'SIB', 'SSB'
]);

// Rate limit: at most RATE_MAX submits per hashed IP within RATE_WINDOW seconds.
const RATE_WINDOW = 10 * 60;
const RATE_MAX = 5;
const MAX_BODY_BYTES = 4096;

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin') || '';
        const allowed = parseAllowedOrigins(env);
        const cors = corsHeaders(origin, allowed);

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: cors });
        }

        const { pathname } = new URL(request.url);
        try {
            if (pathname === '/leaderboards' && request.method === 'GET') {
                const boards = await loadBoards(env);
                return json({ ok: true, boards: publicBoards(boards) }, 200, cors, {
                    'Cache-Control': 'public, max-age=30'
                });
            }
            if (pathname === '/submit' && request.method === 'POST') {
                if (!allowed.includes(origin)) return json({ ok: false, error: 'forbidden_origin' }, 403, cors);
                return await submit(request, env, cors);
            }
            return json({ ok: false, error: 'not_found' }, 404, cors);
        } catch (err) {
            console.error(err);
            return json({ ok: false, error: 'server_error' }, 500, cors);
        }
    }
};

// === Submit ===
async function submit(request, env, cors) {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ ok: false, error: 'too_large' }, 413, cors);

    let body;
    try {
        body = JSON.parse(raw);
    } catch {
        return json({ ok: false, error: 'bad_json' }, 400, cors);
    }

    const entry = validateEntry(body);
    if (entry.error) return json({ ok: false, error: entry.error }, 400, cors);

    const now = Math.floor(Date.now() / 1000);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

    // Rate limit (hashed IP only).
    const ipHash = await sha256Hex(`${env.RATE_LIMIT_SALT || 'sudoku-leaderboard'}:${ip}`);
    const recent = await env.DB
        .prepare('SELECT COUNT(*) AS n FROM sudoku_rate_limits WHERE ip_hash = ?1 AND created_at > ?2')
        .bind(ipHash, now - RATE_WINDOW)
        .first();
    if (recent && recent.n >= RATE_MAX) return json({ ok: false, error: 'rate_limited' }, 429, cors);
    await env.DB.batch([
        env.DB.prepare('INSERT INTO sudoku_rate_limits (ip_hash, created_at) VALUES (?1, ?2)').bind(ipHash, now),
        env.DB.prepare('DELETE FROM sudoku_rate_limits WHERE created_at < ?1').bind(now - 24 * 60 * 60)
    ]);

    // Optional bot check.
    if (env.TURNSTILE_SECRET) {
        const passed = await verifyTurnstile(env.TURNSTILE_SECRET, body.turnstileToken, ip);
        if (!passed) return json({ ok: false, error: 'turnstile_failed' }, 403, cors);
    }

    // Which boards does this record make? Checked against the live data.
    const candidates = entryBoards(entry);
    const before = await loadBoards(env);
    const candidate = { ...entry, createdAt: now, id: Infinity };
    const targets = candidates.filter(({ kind, key }) => qualifies(kind, before[key] || [], candidate));

    const results = {};
    candidates.forEach(({ key }) => { results[key] = null; });

    if (targets.length > 0) {
        const inserts = targets.map(({ kind, key }) => env.DB
            .prepare('INSERT INTO sudoku_scores (board, initials, time_sec, mistakes, score, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
            .bind(key, entry.initials, entry.time, entry.mistakes,
                kind === 'combo-score' ? entry.score : null, now));
        // Keep only the top 10 of each touched board (runs in the same transaction).
        const trims = targets.map(({ kind, key }) => env.DB
            .prepare(`DELETE FROM sudoku_scores WHERE board = ?1 AND id NOT IN (
                SELECT id FROM sudoku_scores WHERE board = ?1 ORDER BY ${orderBy(kind)} LIMIT ${TOP_N})`)
            .bind(key));
        const batchResults = await env.DB.batch([...inserts, ...trims]);

        const after = await loadBoards(env);
        targets.forEach(({ key }, i) => {
            const insertedId = batchResults[i].meta.last_row_id;
            const rank = after[key].findIndex((row) => row.id === insertedId);
            results[key] = rank === -1 ? null : rank + 1;
        });
        return json({ ok: true, results, boards: publicBoards(after) }, 200, cors);
    }

    return json({ ok: true, results, boards: publicBoards(before) }, 200, cors);
}

function validateEntry(body) {
    if (!body || typeof body !== 'object') return { error: 'bad_body' };
    const { mode, difficulty, time, mistakes, score } = body;
    const initials = typeof body.initials === 'string' ? body.initials.trim().toUpperCase() : '';

    if (mode !== 'normal' && mode !== 'combo' && mode !== DAILY) return { error: 'bad_mode' };
    if (!DIFFICULTIES.includes(difficulty)) return { error: 'bad_difficulty' };
    // The daily puzzle is always Medium-sized and only today's board takes records.
    if (mode === DAILY && difficulty !== 'medium') return { error: 'bad_difficulty' };
    if (mode === DAILY && body.date !== todayKey()) return { error: 'bad_date' };
    if (!Number.isInteger(time) || time < MIN_TIME[difficulty] || time > MAX_TIME) return { error: 'bad_time' };
    if (!Number.isInteger(mistakes) || mistakes < 0 || mistakes > MAX_MISTAKES) return { error: 'bad_mistakes' };
    if (!INITIALS_RE.test(initials)) return { error: 'bad_initials' };
    if (BLOCKED_INITIALS.has(initials)) return { error: 'blocked_initials' };

    let comboScore = null;
    if (mode === 'combo') {
        const maxScore = MAX_EMPTY_CELLS[difficulty] * MAX_POINTS_PER_CELL;
        if (!Number.isInteger(score) || score < 0 || score > maxScore) return { error: 'bad_score' };
        comboScore = score;
    }
    return { mode, difficulty, time, mistakes, score: comboScore, initials };
}

// Today's date in Korea time (YYYY-MM-DD): the daily puzzle changes at midnight KST.
function todayKey() {
    return new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function dailyBoardKey() {
    return `${DAILY}-${todayKey()}`;
}

// Boards a valid entry competes on: [{ kind, key }].
function entryBoards(entry) {
    if (entry.mode === DAILY) return [{ kind: DAILY, key: dailyBoardKey() }];
    const kinds = entry.mode === 'combo' ? ['combo-time', 'combo-score'] : ['normal'];
    return kinds.map((kind) => ({ kind, key: boardKey(kind, entry.difficulty) }));
}

// === Boards ===
function boardKey(kind, difficulty) {
    return `${kind}-${difficulty}`;
}

function orderBy(kind) {
    return kind === 'combo-score'
        ? 'score DESC, time_sec ASC, created_at ASC, id ASC'
        : 'time_sec ASC, mistakes ASC, created_at ASC, id ASC';
}

// Same order as orderBy(): negative when a ranks above b. Ties go to the earlier record.
function compare(kind, a, b) {
    if (kind === 'combo-score' && a.score !== b.score) return b.score - a.score;
    if (a.time !== b.time) return a.time - b.time;
    if (kind !== 'combo-score' && a.mistakes !== b.mistakes) return a.mistakes - b.mistakes;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id - b.id;
}

function qualifies(kind, list, entry) {
    return list.length < TOP_N || compare(kind, entry, list[TOP_N - 1]) < 0;
}

async function loadBoards(env) {
    // Past daily boards stay in the table but are never loaded.
    const dailyKey = dailyBoardKey();
    const { results } = await env.DB
        .prepare(`SELECT id, board, initials, time_sec, mistakes, score, created_at FROM sudoku_scores
            WHERE board NOT LIKE 'daily-%' OR board = ?1`)
        .bind(dailyKey)
        .all();

    const boards = {};
    KINDS.forEach((kind) => DIFFICULTIES.forEach((d) => { boards[boardKey(kind, d)] = []; }));
    boards[dailyKey] = [];

    for (const row of results) {
        if (!boards[row.board]) continue;
        boards[row.board].push({
            id: row.id,
            initials: row.initials,
            time: row.time_sec,
            mistakes: row.mistakes,
            score: row.score,
            createdAt: row.created_at
        });
    }
    for (const [key, list] of Object.entries(boards)) {
        const kind = key === dailyKey
            ? DAILY
            : KINDS.find((k) => key.startsWith(`${k}-`) && DIFFICULTIES.includes(key.slice(k.length + 1)));
        list.sort((a, b) => compare(kind, a, b));
        boards[key] = list.slice(0, TOP_N);
    }
    return boards;
}

// What the browser gets (no internal ids beyond what's needed to highlight a row).
function publicBoards(boards) {
    const out = {};
    for (const [key, list] of Object.entries(boards)) {
        out[key] = list.map(({ initials, time, mistakes, score, createdAt }) => ({ initials, time, mistakes, score, createdAt }));
    }
    return out;
}

// === Helpers ===
function parseAllowedOrigins(env) {
    return String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function corsHeaders(origin, allowed) {
    const headers = { Vary: 'Origin' };
    if (allowed.includes(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
        headers['Access-Control-Allow-Headers'] = 'Content-Type';
        headers['Access-Control-Max-Age'] = '86400';
    }
    return headers;
}

function json(data, status, cors, extra = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors, ...extra }
    });
}

async function sha256Hex(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function verifyTurnstile(secret, token, ip) {
    if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return false;
    const form = new FormData();
    form.append('secret', secret);
    form.append('response', token);
    form.append('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    if (!res.ok) return false;
    const data = await res.json();
    return data.success === true;
}
