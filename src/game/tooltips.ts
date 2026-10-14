import type { CardType } from './types';
import raw from '../../TOOLTIPS.md?raw';

const REQUIRED_CARDS = [
  'knife', 'heart', 'eye', 'tooth', 'moon', 'mirror', 'vampire', 'bandage',
  'ghost', 'fog', 'wolf', 'squid', 'mermaid', 'bubbles', 'skull', 'bone',
  'zombie', 'brain', 'gravestone', 'oni', 'fire', 'hand', 'spider', 'web',
  'egg', 'troll', 'dragon', 'alien', 'imp', 'hellfire', 'snake', 'clown',
  'clown-car', 'balloon', 'succubus', 'lipstick', 'kisses', 'crystal-ball',
  'candle', 'robot', 'lightning', 'outlet', 'bat', 'dolphin', 'wave', 'anchor',
] as const satisfies readonly CardType[];

type MissingCard = Exclude<CardType, (typeof REQUIRED_CARDS)[number]>;
const _allCardsListed: [MissingCard] extends [never] ? true : never = true;
void _allCardsListed;

type Section = 'keywords' | 'cards';

function parseTooltips(source: string): {
  keywords: Record<string, string>;
  aliases: Record<string, string>;
  cards: Record<string, string>;
} {
  let section: Section | null = null;
  let current: { section: Section; name: string; lines: string[] } | null = null;
  const keywords: Record<string, string> = {};
  const aliases: Record<string, string> = {};
  const cards: Record<string, string> = {};

  const flush = () => {
    if (!current) return;
    const body: string[] = [];
    const also: string[] = [];
    for (const line of current.lines) {
      const match = line.match(/^Also matches:\s*(.*)$/i);
      if (match && current.section === 'keywords') {
        also.push(...match[1].split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
      } else if (line.trim()) {
        body.push(line.trim());
      }
    }
    const text = body.join(' ');
    if (!text) throw new Error(`TOOLTIPS.md: "${current.name}" has no text`);
    if (current.section === 'keywords') {
      keywords[current.name.toLowerCase()] = text;
      for (const alias of also) aliases[alias] = current.name.toLowerCase();
    } else {
      cards[current.name] = text;
    }
    current = null;
  };

  for (const line of source.split(/\r?\n/)) {
    if (/^#\s+/.test(line) && !line.startsWith('##')) {
      flush();
      const title = line.replace(/^#\s+/, '').trim().toLowerCase();
      section = title.startsWith('keyword') ? 'keywords' : title.startsWith('card') ? 'cards' : null;
      continue;
    }
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      flush();
      if (!section) throw new Error(`TOOLTIPS.md: "${heading[1].trim()}" is outside Keywords or Cards`);
      current = { section, name: heading[1].trim(), lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  flush();

  const missing = REQUIRED_CARDS.filter(type => !cards[type]);
  const unknown = Object.keys(cards).filter(type => !(REQUIRED_CARDS as readonly string[]).includes(type));
  if (missing.length || unknown.length) {
    const parts = [
      missing.length ? `missing ${missing.join(', ')}` : '',
      unknown.length ? `unknown ${unknown.join(', ')}` : '',
    ].filter(Boolean);
    throw new Error(`TOOLTIPS.md cards: ${parts.join('; ')}`);
  }

  return { keywords, aliases, cards };
}

const parsed = parseTooltips(raw);

export const KEYWORDS: Record<string, string> = parsed.keywords;
export const KEYWORD_ALIASES: Record<string, string> = parsed.aliases;
export const CARD_LABELS: Record<CardType, string> = parsed.cards as Record<CardType, string>;
