import type { CardType } from './types';

// Knife stays out of version-select: its 8 direction sprites are identical in
// the current pack, and they are not a single versionable file.
//
// Hand and wolf *do* have game-state alternate art (hand2 / werewolf), but
// those alts are still style-versioned in lockstep with the base key so a
// player can switch the whole look back to a previous pack.
export const VERSIONABLE_TYPES: CardType[] = [
  'heart', 'eye', 'tooth', 'moon', 'mirror', 'vampire', 'bandage', 'ghost', 'fog',
  'wolf', 'squid', 'mermaid', 'bubbles', 'skull', 'bone', 'zombie', 'brain', 'gravestone',
  'oni', 'fire', 'hand', 'spider', 'web', 'egg', 'troll', 'dragon', 'alien', 'imp',
  'hellfire', 'snake', 'clown', 'clown-car', 'balloon', 'succubus', 'lipstick',
  'kisses', 'crystal-ball', 'candle', 'robot', 'lightning', 'outlet', 'bat',
  'dolphin', 'wave', 'anchor',
];

// A few card types' art key doesn't match their CardType name.
const ART_KEY_OVERRIDES: Partial<Record<CardType, string>> = {
  kisses: 'kiss',
};

// Extra art keys that must follow the same version as the type's base key.
// Using `-vN` filenames (not `hand2.png`) so summoned-hand / werewolf alts
// never collide with a style version of the base card.
const LINKED_ART_KEYS: Partial<Record<CardType, string[]>> = {
  hand: ['hand2'],
  wolf: ['werewolf'],
};

export function baseArtKey(type: CardType): string {
  return ART_KEY_OVERRIDES[type] ?? type;
}

export function artKeysForType(type: CardType): string[] {
  const base = baseArtKey(type);
  return [base, ...(LINKED_ART_KEYS[type] ?? [])];
}

const STORAGE_KEY = 'cardVersions';

export function loadVersionPrefs(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

export function saveVersionPrefs(prefs: Record<string, number>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

export function versionedArtKey(baseKey: string, version: number): string {
  return version > 1 ? `${baseKey}-v${version}` : baseKey;
}

/** Unset prefs follow the newest pack so dropping in a higher -vN just works. */
export function resolvedVersion(prefs: Record<string, number>, key: string, count: number): number {
  return prefs[key] ?? count;
}

// Probes /assets/cards/<baseKey>-vN.png for N = 2..maxVersions, stopping at
// the first missing file. Returns the total version count (always >= 1) —
// the base (unsuffixed) file is assumed to always exist.
export function probeVersionCount(baseKey: string, maxVersions = 5): Promise<number> {
  return new Promise((resolve) => {
    let found = 1;
    const tryNext = (n: number) => {
      if (n > maxVersions) { resolve(found); return; }
      const img = new Image();
      img.onload = () => { found = n; tryNext(n + 1); };
      img.onerror = () => resolve(found);
      img.src = `/assets/cards/${versionedArtKey(baseKey, n)}.png`;
    };
    tryNext(2);
  });
}
