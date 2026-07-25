import type { CardType } from './types';

// Card types excluded from version-select: their alternate art (if any) is
// driven by game state, not a player-chosen "version" —
//   knife: 8 separate per-direction sprites, not a single versionable file
//   hand:  hand2.png is the summoned-hand's alternate gesture (🫳), tied to
//          card.summonedHand, not a style preference
//   wolf:  werewolf.png is the "moon is out" alternate, tied to board state
export const VERSIONABLE_TYPES: CardType[] = [
  'heart', 'eye', 'tooth', 'moon', 'mirror', 'vampire', 'bandage', 'ghost', 'fog',
  'squid', 'mermaid', 'bubbles', 'skull', 'bone', 'zombie', 'brain', 'gravestone',
  'oni', 'fire', 'spider', 'web', 'egg', 'troll', 'dragon', 'alien', 'imp',
  'hellfire', 'snake', 'clown', 'clown-car', 'balloon', 'succubus', 'lipstick',
  'kisses', 'crystal-ball', 'candle', 'robot', 'lightning', 'outlet', 'bat',
  'dolphin', 'wave', 'anchor',
];

// A few card types' art key doesn't match their CardType name.
const ART_KEY_OVERRIDES: Partial<Record<CardType, string>> = {
  kisses: 'kiss',
};

export function baseArtKey(type: CardType): string {
  return ART_KEY_OVERRIDES[type] ?? type;
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
  return version > 1 ? `${baseKey}${version}` : baseKey;
}

// Probes /assets/cards/<baseKey>N.png for N = 2..maxVersions, stopping at the
// first missing file. Returns the total version count (always >= 1) — the
// base (unsuffixed) file is assumed to always exist.
export function probeVersionCount(baseKey: string, maxVersions = 5): Promise<number> {
  return new Promise((resolve) => {
    let found = 1;
    const tryNext = (n: number) => {
      if (n > maxVersions) { resolve(found); return; }
      const img = new Image();
      img.onload = () => { found = n; tryNext(n + 1); };
      img.onerror = () => resolve(found);
      img.src = `/assets/cards/${baseKey}${n}.png`;
    };
    tryNext(2);
  });
}
