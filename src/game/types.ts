export type Direction = 'up' | 'down' | 'left' | 'right' | 'up-left' | 'up-right' | 'down-left' | 'down-right';
export type CardType = 'knife' | 'heart' | 'eye' | 'tooth' | 'moon' | 'mirror' | 'vampire' | 'bandage' | 'ghost' | 'fog' | 'wolf' | 'squid' | 'mermaid' | 'bubbles' | 'skull' | 'bone' | 'zombie' | 'brain' | 'gravestone' | 'oni' | 'fire' | 'hand' | 'spider' | 'web' | 'egg' | 'troll' | 'dragon' | 'alien' | 'imp' | 'hellfire' | 'snake' | 'clown' | 'clown-car' | 'balloon';

export type Card = {
  id: string;
  direction: Direction;
  type: CardType;
  summonedHand?: { emoji: string; angle: number };
};

export type BoardCell = { card: Card; owner: number; fogged?: boolean; zombified?: boolean } | { blood: true } | null;

export type DeckType = 'random' | 'debug' | 'vampire' | 'werewolf' | 'ocean' | 'bones' | 'zombie' | 'oni' | 'spider' | 'knife' | 'demon' | 'clown';

export type PendingChange =
  | { type: 'zombie-convert'; row: number; col: number; owner: number; resolveAfterActor: number }
  | { type: 'gravestone-transform'; row: number; col: number; owner: number; resolveAfterActor: number };

export type GameState = {
  board: BoardCell[][];
  hands: Record<number, Card[]>;
  currentTurn: number;
  phase: 'playing' | 'finished';
  winner: number | null;
  blackPlayer: number;
  pendingChanges: PendingChange[];
};
