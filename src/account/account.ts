import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

export type MatchResult = 'win' | 'loss' | 'draw';
export type RecordStatus = 'saved' | 'skipped' | 'error';

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
let signedIn = false;
let statusText = '';
let booted = false;
let sessionGen = 0;

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

function cleanName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 24) return null;
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
  status.textContent = statusText;

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
    if (signedIn) {
      record.textContent = '—';
      who.textContent = '';
      nameInput.value = '';
    }
    return;
  }

  loggedOut.hidden = true;
  loggedIn.hidden = false;
  record.textContent = formatRecord(current.wins, current.losses, current.draws);
  who.textContent = current.email;
  lobby.hidden = false;
  lobby.textContent = `${current.displayName} · ${formatRecord(current.wins, current.losses, current.draws)}`;
  if (fillName) nameInput.value = current.displayName;
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

async function onSession(session: Session | null) {
  const gen = ++sessionGen;
  booted = true;
  if (!session) {
    const hadUser = signedIn;
    signedIn = false;
    currentUserId = null;
    current = null;
    if (hadUser) statusText = 'logged out';
    else if (statusText === '…') statusText = '';
    paint();
    return;
  }
  signedIn = true;

  let profile = await loadProfile(session);
  if (gen !== sessionGen) return;
  if (!profile) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (gen !== sessionGen) return;
    profile = await loadProfile(session);
    if (gen !== sessionGen) return;
  }
  const switched = session.user.id !== currentUserId;
  currentUserId = session.user.id;
  current = profile;
  if (!profile) {
    statusText = 'account not ready yet';
    paint();
    return;
  }
  if (switched) statusText = '';
  paint(switched);
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
    statusText = 'use 1–24 characters';
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
      ? 'use 1–24 characters'
      : "couldn't save that name";
    paint();
    return;
  }
  current = { ...current, displayName: name };
  el<HTMLInputElement>('account-name').value = name;
  statusText = 'name saved';
  paint();
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

export function initAccount(): void {
  if (!configured) {
    paint();
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
  }
  return 'saved';
}
