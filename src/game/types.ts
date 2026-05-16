export type Direction = 'up' | 'down' | 'left' | 'right' | 'up-left' | 'up-right' | 'down-left' | 'down-right';
export type CardType = 'knife' | 'heart' | 'eye' | 'tooth' | 'moon' | 'mirror' | 'vampire' | 'bandage' | 'ghost' | 'fog' | 'wolf' | 'squid' | 'mermaid' | 'bubbles' | 'skull' | 'bone' | 'zombie' | 'brain' | 'gravestone' | 'oni' | 'fire' | 'hand' | 'spider' | 'web' | 'egg' | 'troll' | 'dragon' | 'alien' | 'imp' | 'hellfire' | 'snake' | 'clown' | 'clown-car' | 'balloon' | 'succubus' | 'lipstick' | 'kisses' | 'crystal-ball' | 'candle' | 'robot' | 'lightning' | 'outlet';

export type Card = {
  id: string;
  direction: Direction;
  type: CardType;
  summonedHand?: { emoji: string; angle: number };
};

export type BoardCell = { card: Card; owner: number; fogged?: boolean; zombified?: boolean } | { blood: true } | null;

export type DeckType = 'random' | 'debug' | 'vampire' | 'werewolf' | 'ocean' | 'bones' | 'zombie' | 'oni' | 'spider' | 'knife' | 'demon' | 'clown' | 'succubus' | 'ghost' | 'robot';

export type PendingChange =
  | { type: 'zombie-convert'; row: number; col: number; owner: number; resolveAfterActor: number }
  | { type: 'gravestone-transform'; row: number; col: number; owner: number; resolveAfterActor: number };

export type GameState = {
  board: BoardCell[][];
  hands: Record<number, Card[]>;
  /** Active player's actorNr. Set to -1 (sentinel) when phase === 'finished'. */
  currentTurn: number;
  phase: 'playing' | 'finished';
  winner: number | null;
  blackPlayer: number;
  pendingChanges: PendingChange[];
  lastPlayed?: Record<number, Card>;
  fireChain?: [number, number][];
  hellfirePos?: [number, number];
  candleFirePos?: [number, number];
  lightningTargets?: [number, number][];
  crystalBallReturn?: { fromRow: number; fromCol: number; card: Card; actorNr: number };
};
