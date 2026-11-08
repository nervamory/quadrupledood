import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

export type MatchResult = 'win' | 'loss' | 'draw';
export type RecordStatus = 'saved' | 'skipped' | 'error';

export type LeaderboardEntry = {
  id: string;
  displayName: string;
  wins: number;
  losses: number;
  draws: number;
  rank: number;
};

type Profile = {
  email: string;
  displayName: string;
  wins: number;
  losses: number;
  draws: number;
};

type RecordedMatch = {
  display_name: string;
  wins: number;
  losses: number;
  draws: number;
  applied: boolean;
};

const url = readEnv('VITE_SUPABASE_URL') || 'https://yjqqzvbvntkoyhyxlgle.supabase.co';
const anonKey = readEnv('VITE_SUPABASE_ANON_KEY') || 'sb_publishable_8QLrVCSi76bzsbhYIJ-ycA_lYlmDOLT';
const configured = url.startsWith('https://') && anonKey.length >= 20;

let client: SupabaseClient | null = null;
let current: Profile | null = null;
let currentUserId: string | null = null;
let currentRank: number | null = null;
let signedIn = false;
let statusText = '';
let booted = false;
let sessionGen = 0;
const userListeners: Array<(userId: string | null) => void> = [];
const nameListeners: Array<(name: string | null) => void> = [];
const rankListeners: Array<(rank: number | null) => void> = [];
const rankByUserId = new Map<string, number>();
const rankLookupDone = new Set<string>();

function readEnv(name: 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY'): string {
  const value = import.meta.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function db(): SupabaseClient {
  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        flowType: 'pkce',
        detectSessionInUrl: true,
        persistSession: true,
      },
    });
  }
  return client;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Required element #${id} not found`);
  return node as T;
}

function formatRecord(wins: number, losses: number, draws: number): string {
  const parts = [
    wins === 1 ? '1 win' : `${wins} wins`,
    losses === 1 ? '1 loss' : `${losses} losses`,
  ];
  if (draws > 0) parts.push(draws === 1 ? '1 draw' : `${draws} draws`);
  return parts.join(' · ');
}

/** Prefix a display name with its global rank when known, e.g. "#1 nervamory". */
export function formatRankedName(name: string, rank: number | null | undefined): string {
  const clean = name.trim();
  if (!clean) return '';
  if (rank == null || !Number.isFinite(rank) || rank < 1) return clean;
  return `#${Math.floor(rank)} ${clean}`;
}

const NAME_MAX = 12;

function cleanName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > NAME_MAX) return null;
  if (/[\u0000-\u001F\u007F]/.test(name)) return null;
  return name;
}

function friendlySendError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('rate') || lower.includes('only request this')) return 'wait a moment and try again';
  if (lower.includes('redirect') || lower.includes('not allowed')) return "this site isn't allowed to send login links yet";
  if (lower.includes('fetch') || lower.includes('network') || lower.includes('failed to')) return "couldn't reach the account server";
  return "couldn't send the login link";
}

function showLine(node: HTMLElement, text: string) {
  node.textContent = text;
  node.hidden = text.trim() === '';
}

function paint(fillName = false) {
  const panel = el('account-panel');
  const loggedOut = el('account-logged-out');
  const loggedIn = el('account-logged-in');
  const record = el('account-record');
  const who = el('account-who');
  const lobby = el('lobby-account');
  const status = el('account-status');
  const nameInput = el<HTMLInputElement>('account-name');

  if (!configured) {
    panel.hidden = true;
    lobby.hidden = true;
    return;
  }

  panel.hidden = false;
  showLine(status, statusText);

  if (!booted) {
    loggedOut.hidden = true;
    loggedIn.hidden = true;
    lobby.hidden = true;
    return;
  }

  loggedOut.hidden = signedIn;
  loggedIn.hidden = !signedIn;
  if (!signedIn || !current) {
    lobby.hidden = true;
    lobby.textContent = '';
    showLine(record, '');
    showLine(who, '');
    if (signedIn) nameInput.value = '';
    return;
  }

  loggedOut.hidden = true;
  loggedIn.hidden = false;
  const recordBits = [formatRecord(current.wins, current.losses, current.draws)];
  if (currentRank != null) recordBits.unshift(`#${currentRank}`);
  showLine(record, recordBits.join(' · '));
  showLine(who, current.email);
  lobby.hidden = false;
  const ranked = formatRankedName(current.displayName, currentRank);
  lobby.textContent = `${ranked} · ${formatRecord(current.wins, current.losses, current.draws)}`;
  const savedName = current.displayName;
  const nameDirty = nameInput.value.trim() !== '' && nameInput.value !== savedName;
  const nameFocused = document.activeElement === nameInput;
  if (fillName || !(nameFocused || nameDirty)) nameInput.value = savedName;
}

function setRank(next: number | null) {
  const normalized = next != null && Number.isFinite(next) && next >= 1 ? Math.floor(next) : null;
  if (normalized === currentRank) return;
  currentRank = normalized;
  paint();
  emitRank();
  emitName();
}

function rememberRanks(entries: LeaderboardEntry[]) {
  rankByUserId.clear();
  rankLookupDone.clear();
  for (const entry of entries) {
    if (!entry.id) continue;
    rankByUserId.set(entry.id, entry.rank);
    rankLookupDone.add(entry.id);
  }
  if (currentUserId) rankLookupDone.add(currentUserId);
}

async function loadProfile(session: Session): Promise<Profile | null> {
  const { data, error } = await db()
    .from('profiles')
    .select('display_name, wins, losses, draws')
    .eq('id', session.user.id)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { display_name: string; wins: number; losses: number; draws: number };
  return {
    email: session.user.email ?? '',
    displayName: row.display_name,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
  };
}

async function refreshOwnRank(userId: string | null = currentUserId): Promise<void> {
  if (!configured || !userId) {
    setRank(null);
    return;
  }
  const cached = rankByUserId.get(userId);
  if (cached != null) {
    setRank(cached);
  }
  const { data, error } = await db().rpc('player_rank', { player_id: userId });
  if (error) {
    // Migration not applied yet, or transient failure — keep any cached rank.
    if (cached == null) setRank(null);
    return;
  }
  const value = typeof data === 'number' ? data : data == null ? null : Number(data);
  setRank(value);
  if (value != null) rankByUserId.set(userId, value);
}

async function onSession(session: Session | null) {
  const gen = ++sessionGen;
  booted = true;
  if (!session) {
    const hadUser = signedIn;
    signedIn = false;
    currentUserId = null;
    current = null;
    setRank(null);
    if (hadUser || statusText === '…') statusText = '';
    paint();
    emitUser();
    emitName();
    return;
  }
  signedIn = true;
  const switched = session.user.id !== currentUserId;
  currentUserId = session.user.id;
  if (switched) emitUser();

  let profile = await loadProfile(session);
  if (gen !== sessionGen) return;
  if (!profile) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (gen !== sessionGen) return;
    profile = await loadProfile(session);
    if (gen !== sessionGen) return;
  }
  current = profile;
  if (!profile) {
    statusText = 'account not ready yet';
    setRank(null);
    paint();
    emitName();
    return;
  }
  if (switched) statusText = '';
  paint(switched);
  emitName();
  void refreshOwnRank(session.user.id);
}

async function sendLink() {
  const email = el<HTMLInputElement>('account-email').value.trim();
  const button = el<HTMLButtonElement>('account-login-btn');
  if (button.disabled) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    statusText = 'enter an email address';
    paint();
    return;
  }
  button.disabled = true;
  button.textContent = 'sending…';
  const { error } = await db().auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: window.location.origin,
    },
  });
  button.disabled = false;
  button.textContent = 'log in';
  statusText = error ? friendlySendError(error.message) : 'check your email. open the link in this browser.';
  paint();
}

async function saveName() {
  if (!currentUserId || !current) return;
  const name = cleanName(el<HTMLInputElement>('account-name').value);
  const button = el<HTMLButtonElement>('account-save-btn');
  if (button.disabled) return;
  if (!name) {
    statusText = `use 1–${NAME_MAX} characters`;
    paint();
    return;
  }
  if (name === current.displayName) {
    statusText = 'name saved';
    paint();
    return;
  }
  button.disabled = true;
  const { error } = await db().from('profiles').update({ display_name: name }).eq('id', currentUserId);
  button.disabled = false;
  if (error) {
    statusText = error.message.toLowerCase().includes('display_name')
      ? `use 1–${NAME_MAX} characters`
      : "couldn't save that name";
    paint();
    return;
  }
  current = { ...current, displayName: name };
  el<HTMLInputElement>('account-name').value = name;
  statusText = 'name saved';
  paint();
  emitName();
}

async function logOut() {
  const button = el<HTMLButtonElement>('account-logout-btn');
  button.disabled = true;
  const { error } = await db().auth.signOut();
  button.disabled = false;
  if (error) {
    statusText = "couldn't log out";
    paint();
  }
}

function parseRecorded(data: unknown): RecordedMatch | null {
  let value: unknown = data;
  if (typeof value === 'string') {
    try { value = JSON.parse(value) as unknown; } catch { return null; }
  }
  const row = (Array.isArray(value) ? value[0] : value) as Partial<RecordedMatch> | null;
  if (!row || typeof row.wins !== 'number' || typeof row.losses !== 'number' || typeof row.draws !== 'number') {
    return null;
  }
  return {
    display_name: typeof row.display_name === 'string' ? row.display_name : '',
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    applied: row.applied !== false,
  };
}

function parseLeaderboardRow(row: Record<string, unknown>): LeaderboardEntry | null {
  const id = typeof row.id === 'string' ? row.id : '';
  const displayName = typeof row.display_name === 'string' ? row.display_name.trim() : '';
  const wins = typeof row.wins === 'number' ? row.wins : NaN;
  const losses = typeof row.losses === 'number' ? row.losses : NaN;
  const draws = typeof row.draws === 'number' ? row.draws : 0;
  const rank = typeof row.rank === 'number' ? row.rank : Number(row.rank);
  if (!id || !displayName || !Number.isFinite(wins) || !Number.isFinite(losses) || !Number.isFinite(rank) || rank < 1) {
    return null;
  }
  return { id, displayName, wins, losses, draws: Number.isFinite(draws) ? draws : 0, rank: Math.floor(rank) };
}

/** Client-side ranking used when the leaderboard RPC isn't migrated yet. */
function rankLocally(rows: Array<{
  id: string;
  display_name: string;
  wins: number;
  losses: number;
  draws: number;
  last_win_at: string | null;
  last_match_at: string | null;
}>): LeaderboardEntry[] {
  const played = rows.filter((row) => row.wins + row.losses + row.draws > 0);
  played.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.losses !== b.losses) return a.losses - b.losses;
    const aWin = a.last_win_at ?? a.last_match_at ?? '';
    const bWin = b.last_win_at ?? b.last_match_at ?? '';
    if (aWin === bWin) return 0;
    if (!aWin) return 1;
    if (!bWin) return -1;
    return aWin < bWin ? 1 : -1;
  });
  return played.map((row, index) => ({
    id: row.id,
    displayName: row.display_name,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    rank: index + 1,
  }));
}

export function accountUserId(): string | null {
  return signedIn ? currentUserId : null;
}

export function accountDisplayName(): string | null {
  const name = signedIn && current ? current.displayName.trim() : '';
  return name ? name : null;
}

export function accountRank(): number | null {
  return signedIn ? currentRank : null;
}

export function rankForUser(userId: string | null | undefined): number | null {
  if (!userId || userId.startsWith('guest-')) return null;
  return rankByUserId.get(userId) ?? null;
}

/** Resolve and cache ranks for Photon seat user ids (skips guests). */
export async function ensureRanks(userIds: Array<string | null | undefined>): Promise<boolean> {
  if (!configured) return false;
  const wanted = [...new Set(
    userIds
      .map((id) => (id ?? '').trim())
      .filter((id) => id && !id.startsWith('guest-') && !rankLookupDone.has(id)),
  )];
  if (wanted.length === 0) return false;
  let changed = false;
  await Promise.all(wanted.map(async (id) => {
    const { data, error } = await db().rpc('player_rank', { player_id: id });
    rankLookupDone.add(id);
    if (error) return;
    const value = typeof data === 'number' ? data : data == null ? null : Number(data);
    if (value != null && Number.isFinite(value) && value >= 1) {
      rankByUserId.set(id, Math.floor(value));
      changed = true;
      if (id === currentUserId) setRank(Math.floor(value));
    }
  }));
  return changed;
}

export function onAccountName(cb: (name: string | null) => void): void {
  nameListeners.push(cb);
  if (booted) cb(accountDisplayName());
}

function emitName() {
  const name = accountDisplayName();
  for (const cb of nameListeners) cb(name);
}

export function onAccountUser(cb: (userId: string | null) => void): void {
  userListeners.push(cb);
  if (booted) cb(accountUserId());
}

function emitUser() {
  const id = accountUserId();
  for (const cb of userListeners) cb(id);
}

export function onAccountRank(cb: (rank: number | null) => void): void {
  rankListeners.push(cb);
  if (booted) cb(accountRank());
}

function emitRank() {
  const rank = accountRank();
  for (const cb of rankListeners) cb(rank);
}

export function initAccount(): void {
  if (!configured) {
    booted = true;
    paint();
    emitUser();
    emitName();
    emitRank();
    return;
  }
  statusText = '…';
  paint();

  el<HTMLButtonElement>('account-login-btn').addEventListener('click', () => { void sendLink(); });
  el<HTMLInputElement>('account-email').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void sendLink();
    }
  });
  el<HTMLButtonElement>('account-save-btn').addEventListener('click', () => { void saveName(); });
  el<HTMLInputElement>('account-name').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void saveName();
    }
  });
  el<HTMLButtonElement>('account-logout-btn').addEventListener('click', () => { void logOut(); });

  db().auth.onAuthStateChange((_event, session) => {
    setTimeout(() => { void onSession(session); }, 0);
  });

  void fetchLeaderboard();
}

export async function fetchLeaderboard(limit = 50): Promise<LeaderboardEntry[]> {
  if (!configured) return [];

  const { data, error } = await db().rpc('leaderboard', { limit_count: limit });
  if (!error && Array.isArray(data)) {
    const entries = data
      .map((row) => parseLeaderboardRow(row as Record<string, unknown>))
      .filter((row): row is LeaderboardEntry => row !== null);
    rememberRanks(entries);
    if (currentUserId) {
      const own = entries.find((entry) => entry.id === currentUserId);
      if (own) setRank(own.rank);
      else void refreshOwnRank(currentUserId);
    }
    return entries;
  }

  // Fallback before migrate_leaderboard.sql is applied.
  const { data: rows, error: selectError } = await db()
    .from('profiles')
    .select('id, display_name, wins, losses, draws, last_match_at, last_win_at');
  if (selectError) {
    // last_win_at may be missing — retry without it.
    const { data: basic, error: basicError } = await db()
      .from('profiles')
      .select('id, display_name, wins, losses, draws, last_match_at');
    if (basicError || !basic) return [];
    const entries = rankLocally(
      (basic as Array<{
        id: string;
        display_name: string;
        wins: number;
        losses: number;
        draws: number;
        last_match_at: string | null;
      }>).map((row) => ({ ...row, last_win_at: null })),
    ).slice(0, limit);
    rememberRanks(entries);
    if (currentUserId) {
      const own = entries.find((entry) => entry.id === currentUserId);
      setRank(own?.rank ?? null);
    }
    return entries;
  }

  const entries = rankLocally(rows as Array<{
    id: string;
    display_name: string;
    wins: number;
    losses: number;
    draws: number;
    last_win_at: string | null;
    last_match_at: string | null;
  }>).slice(0, limit);
  rememberRanks(entries);
  if (currentUserId) {
    const own = entries.find((entry) => entry.id === currentUserId);
    setRank(own?.rank ?? null);
  }
  return entries;
}

export async function recordMatch(result: MatchResult): Promise<RecordStatus> {
  if (!configured) return 'skipped';
  const { data: sessionData } = await db().auth.getSession();
  if (!sessionData.session) return 'skipped';
  const { data, error } = await db().rpc('record_match', { outcome: result });
  if (error) {
    console.warn('record_match', error.message);
    return 'error';
  }
  const recorded = parseRecorded(data);
  if (!recorded) return 'error';
  if (current && currentUserId === sessionData.session.user.id) {
    current = {
      ...current,
      displayName: recorded.display_name || current.displayName,
      wins: recorded.wins,
      losses: recorded.losses,
      draws: recorded.draws,
    };
    paint();
    emitName();
    void fetchLeaderboard();
  }
  return 'saved';
}
