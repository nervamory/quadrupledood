import type { GameState, Card, CardType, Direction } from './types';

const CARD = 68;
const CELL = 72;
const CELL_GAP = 8;
const GRID = 4 * CELL + 3 * CELL_GAP; // 312

const KNIFE_ANGLES: Record<Direction, number> = {
  right: -Math.PI / 4,    down: Math.PI / 4,
  left:  3 * Math.PI / 4, up:   -3 * Math.PI / 4,
  'up-right':   -Math.PI / 2, 'down-right': 0,
  'down-left':   Math.PI / 2, 'up-left':    Math.PI,
};

// Fan layout constants — canvas is 680×700
const FAN_RADIUS = 350;
const FAN_HALF_ANGLE = 28 * Math.PI / 180; // ±28°, 56° total spread

const SPIN_DURATION = 4800; // ms for the knife to spin and settle
const SPIN_HOLD     = 1100; // ms to hold the result before showing the board

// Center-card cy for each hand (pivot is FAN_RADIUS away from center)
// Midpoint between the two hand centers = 350 (canvas center at H=700)
const MY_HAND_CY = 600;
const OPP_HAND_CY = 100;
const MY_PIVOT_Y = MY_HAND_CY + FAN_RADIUS;    // 950 — below canvas
const OPP_PIVOT_Y = OPP_HAND_CY - FAN_RADIUS;  // −250 — above canvas

type CardLayout = { cx: number; cy: number; rotation: number; card: Card };

type FlipAnim = {
  row: number; col: number;
  startTime: number;
  oldCard: Card; oldIsBlack: boolean;
  newCard: Card; newIsBlack: boolean;
};

const CARD_LABELS: Record<CardType, string> = {
  knife:   'immune to capture from its point',
  heart:   'becomes blood when captured',
  eye:     "reveals opponent's hand",
  tooth:   'immune when touching bone',
  moon:    'flips all card ownership',
  mirror:  'reflects captures back',
  bandage: 'plays on blood cells',
  vampire: 'captures all blood cells',
  ghost:   'switches entire hands with opponent',
  fog:     'hides nearby cards from opponent',
  wolf:    "switches to orthogonal when moon's out",
  squid:   'pops bubbles, they capture touching',
  mermaid: 'pulls opponent card onto board',
  bubbles: 'pops when captured; counter capture',
  skull:   'immune when touching bone',
  bone:    'immune when touching bone',
  zombie:  'zombifies touching; converts next turn',
  brain:   'becomes blood when captured',
  gravestone: 'become zombie if uncaptured',
  oni:     'summons 2 flanking hand cards',
  fire:    'wildfire: transforms in direction, chaining',
  hand:    'captures in finger direction',
  spider:  'captures all 8 touching cells',
  web:     'replaces any played card',
  egg:     'hatches a spider if captured',
  troll:   'captures 4 orthogonal neighbors',
  dragon:  'pierces line, ignores mirrors',
  alien:   'captures all knight-move positions',
  imp:      'retriggers captured ally',
  hellfire: 'destroys all touching; self-destructs',
  snake:    'multi-square capture',
  clown:    'retriggers touching clowns',
  'clown-car': 'spawns a clown each turn',
  balloon:  'pops when captured',
  succubus: 'pulls orthogonal closer before capturing',
  lipstick: 'retriggers touching kisses',
  kisses:   'captures one random touching card',
  'crystal-ball': 'returns your last played card to hand',
  candle:   'turns capturer into fire',
  robot:    'flips all touching ownership each turn',
  lightning: 'destroys one random touching card',
  outlet:   'captures up & down; retriggers all lightnings on board',
};

type SwapCardAnim = {
  card: Card;
  fromX: number; fromY: number; fromRotation: number;
  toX: number;   toY: number;   toRotation: number;
  startFaceDown: boolean; startIsBlack: boolean; endIsBlack: boolean;
};

export class Game {
  private ctx: CanvasRenderingContext2D;
  private readonly W: number;
  private readonly H: number;
  private readonly gridX: number;
  private readonly gridY = 194;

  private state: GameState | null = null;
  private localNr = 0;
  private drag: { card: Card; x: number; y: number } | null = null;
  private hoverPos: { x: number; y: number } | null = null;
  private raf = 0;
  private spinAnim: { startTime: number; done: boolean; firstPlayer: number } | null = null;
  private lastHoverIdx: number | null = null;
  private matchScore: Record<number, number> = {};
  oppHoverIdx: number | null = null;

  private flipAnims: FlipAnim[] = [];

  private hellfireAnim: {
    cells: { row: number; col: number; card: Card; isBlack: boolean }[];
    startTime: number;
  } | null = null;

  private ghostSwapAnim: {
    startTime: number;
    cards: SwapCardAnim[];
    hiddenIds: Set<string>;
    done: boolean;
  } | null = null;

  private cbReturnAnim: {
    card: Card;
    fromX: number; fromY: number;
    toX: number; toY: number;
    startTime: number;
    done: boolean;
    isBlack: boolean;
    hiddenId: string;
  } | null = null;

  private lightningFlashAnims: { row: number; col: number; startTime: number }[] = [];
  private scoreAnimMy: number | null = null;
  private scoreAnimOpp: number | null = null;

  onPlaceCard?: (cardId: string, row: number, col: number) => void;
  onHoverChange?: (idx: number | null) => void;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.W = canvas.width;
    this.H = canvas.height;
    this.gridX = (this.W - GRID) / 2;

    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mouseup', this.onMouseUp);
    canvas.addEventListener('contextmenu', (e) => {
      if (this.drag) { e.preventDefault(); this.drag = null; }
    });
    canvas.addEventListener('mouseleave', () => {
      this.hoverPos = null;
      if (this.lastHoverIdx !== null) {
        this.lastHoverIdx = null;
        this.onHoverChange?.(null);
      }
    });
  }

  setLocalActor(actorNr: number) {
    this.localNr = actorNr;
    if (!this.raf) this.start();
  }

  setMatchScore(score: Record<number, number>) {
    this.matchScore = { ...score };
  }

  setState(state: GameState | null) {
    if (state && !this.state) {
      this.spinAnim = { startTime: performance.now(), done: false, firstPlayer: state.currentTurn };
    }
    if (!state) { this.spinAnim = null; this.ghostSwapAnim = null; this.hellfireAnim = null; this.cbReturnAnim = null; this.lightningFlashAnims = []; this.scoreAnimMy = null; this.scoreAnimOpp = null; }
    if (state && this.state) {
      this.detectGhostSwap(this.state, state);
      this.detectFlips(this.state, state);
      this.detectHellfire(this.state, state);
      this.detectCrystalBallReturn(this.state, state);
      this.detectLightningFlash(state);
      this.detectScoreChange(this.state, state);
    }
    this.state = state;
  }

  private detectGhostSwap(oldState: GameState, newState: GameState) {
    const playerNrs = Object.keys(newState.hands).map(Number);
    const oppNr = playerNrs.find(n => n !== this.localNr);
    if (oppNr === undefined || this.localNr === 0) return; // localNr 0 = not yet initialised (Photon assigns from 1)

    const oldMyHand  = oldState.hands[this.localNr] ?? [];
    const newMyHand  = newState.hands[this.localNr] ?? [];
    const oldOppHand = oldState.hands[oppNr] ?? [];
    const newOppHand = newState.hands[oppNr] ?? [];

    const newMyIds  = new Set(newMyHand.map(c => c.id));
    const newOppIds = new Set(newOppHand.map(c => c.id));

    // Cards that moved from my hand → opp's hand
    const fromMeCards  = oldMyHand.filter(c => !newMyIds.has(c.id)  && newOppIds.has(c.id));
    // Cards that moved from opp's hand → my hand
    const fromOppCards = oldOppHand.filter(c => !newOppIds.has(c.id) && newMyIds.has(c.id));
    if (fromMeCards.length === 0 || fromOppCards.length === 0) return;

    const oldMyLayout  = this.computeHandLayout(oldMyHand, true);
    const oldOppLayout = this.computeHandLayout(oldOppHand, false);
    const myIsBlack  = this.localNr === oldState.blackPlayer;
    const oppIsBlack = oppNr === oldState.blackPlayer;
    const myEyeActive = oldState.board.flat().some(
      c => c && 'card' in c && c.owner === this.localNr && c.card.type === 'eye'
    );

    const swapCards: SwapCardAnim[] = [];
    const hiddenIds = new Set<string>();

    for (const c of fromMeCards) {
      const l = oldMyLayout.find(l => l.card.id === c.id);
      if (!l) continue;
      swapCards.push({
        card: c,
        fromX: l.cx, fromY: l.cy, fromRotation: l.rotation,
        toX: this.W / 2, toY: OPP_HAND_CY, toRotation: 0,
        startFaceDown: false, startIsBlack: myIsBlack, endIsBlack: oppIsBlack,
      });
      hiddenIds.add(c.id);
    }
    for (const c of fromOppCards) {
      const l = oldOppLayout.find(l => l.card.id === c.id);
      if (!l) continue;
      swapCards.push({
        card: c,
        fromX: l.cx, fromY: l.cy, fromRotation: l.rotation,
        toX: this.W / 2, toY: MY_HAND_CY, toRotation: 0,
        startFaceDown: !myEyeActive, startIsBlack: oppIsBlack, endIsBlack: myIsBlack,
      });
      hiddenIds.add(c.id);
    }

    if (swapCards.length === 0) return;
    this.ghostSwapAnim = {
      startTime: performance.now(),
      cards: swapCards,
      hiddenIds,
      done: false,
    };
  }

  private detectFlips(oldState: GameState, newState: GameState) {
    if (this.localNr === 0) return;
    const now = performance.now();
    const FIRE_STAGGER_MS = 150;
    const fireChain = newState.fireChain ?? [];
    const candleFirePos = newState.candleFirePos;
    const isCandlePlay = !!candleFirePos;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const old = oldState.board[r][c];
        const next = newState.board[r][c];
        if (old && 'card' in old && next && 'card' in next && old.owner !== next.owner) {
          this.flipAnims = this.flipAnims.filter(f => !(f.row === r && f.col === c));
          const isCandleCell = isCandlePlay && candleFirePos![0] === r && candleFirePos![1] === c;
          const chainIdx = fireChain.findIndex(([fr, fc]) => fr === r && fc === c);
          const delay = isCandleCell
            ? FIRE_STAGGER_MS
            : chainIdx >= 0
              ? (isCandlePlay ? chainIdx + 2 : chainIdx) * FIRE_STAGGER_MS
              : 0;
          this.flipAnims.push({
            row: r, col: c,
            startTime: now + delay,
            oldCard: old.card, oldIsBlack: old.owner === oldState.blackPlayer,
            newCard: next.card, newIsBlack: next.owner === newState.blackPlayer,
          });
        }
      }
    }
  }

  private detectHellfire(oldState: GameState, newState: GameState) {
    if (!newState.hellfirePos) return;
    const [hr, hc] = newState.hellfirePos;
    const cells: { row: number; col: number; card: Card; isBlack: boolean }[] = [];
    for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,0],[0,1],[1,-1],[1,0],[1,1]] as [number,number][]) {
      const r = hr + dr, c = hc + dc;
      if (r < 0 || r >= 4 || c < 0 || c >= 4) continue;
      const cell = oldState.board[r][c];
      if (cell && 'card' in cell) {
        cells.push({ row: r, col: c, card: cell.card, isBlack: cell.owner === oldState.blackPlayer });
      }
    }
    this.hellfireAnim = { cells, startTime: performance.now() };
  }

  private drawHellfireAnim(now: number) {
    if (!this.hellfireAnim) return;
    const SHOW_MS  = 300; // green fire visible before fade
    const FADE_MS  = 200; // fade out duration
    const t = now - this.hellfireAnim.startTime;
    const ctx = this.ctx;
    const pad = (CELL - CARD) / 2;

    for (const { row, col, card, isBlack } of this.hellfireAnim.cells) {
      const { x, y } = this.cellPos(row, col);
      const alpha = t < SHOW_MS ? 1 : Math.max(0, 1 - (t - SHOW_MS) / FADE_MS);
      ctx.save();
      ctx.globalAlpha = alpha;
      this.drawCard(x + pad, y + pad, card, isBlack);
      ctx.font = '32px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.filter = 'hue-rotate(120deg)'; // orange fire → green
      ctx.fillText('🔥', x + CELL / 2, y + CELL / 2);
      ctx.filter = 'none';
      ctx.restore();
    }

    if (t > SHOW_MS + FADE_MS) this.hellfireAnim = null;
  }

  private detectLightningFlash(newState: GameState) {
    const targets = newState.lightningTargets;
    if (!targets || targets.length === 0) return;
    const now = performance.now();
    for (const [row, col] of targets) {
      this.lightningFlashAnims = this.lightningFlashAnims.filter(a => !(a.row === row && a.col === col));
      this.lightningFlashAnims.push({ row, col, startTime: now });
    }
  }

  private drawLightningFlash(now: number) {
    if (this.lightningFlashAnims.length === 0) return;
    const DURATION = 350;
    const ctx = this.ctx;
    this.lightningFlashAnims = this.lightningFlashAnims.filter(a => now - a.startTime < DURATION);
    for (const { row, col, startTime } of this.lightningFlashAnims) {
      const t = (now - startTime) / DURATION;
      const alpha = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8; // quick ramp up, slow fade
      const { x, y } = this.cellPos(row, col);
      ctx.save();
      ctx.globalAlpha = alpha * 0.75;
      ctx.fillStyle = '#ffe066';
      ctx.fillRect(x, y, CELL, CELL);
      ctx.restore();
    }
  }

  private detectScoreChange(oldState: GameState, newState: GameState) {
    if (this.localNr === 0) return;
    const playerNrs = Object.keys(newState.hands).map(Number);
    const oppNr = playerNrs.find(n => n !== this.localNr);
    const scoreOf = (s: GameState, nr: number) =>
      s.board.flat().filter(c => c && 'card' in c && c.owner === nr && !c.zombified).length;
    const now = performance.now();
    if (scoreOf(newState, this.localNr) !== scoreOf(oldState, this.localNr)) this.scoreAnimMy = now;
    if (oppNr !== undefined && scoreOf(newState, oppNr) !== scoreOf(oldState, oppNr)) this.scoreAnimOpp = now;
  }

  private detectCrystalBallReturn(_oldState: GameState, newState: GameState) {
    if (this.localNr === 0) return;
    const cbr = newState.crystalBallReturn;
    if (!cbr || cbr.actorNr !== this.localNr) return;

    const { x, y } = this.cellPos(cbr.fromRow, cbr.fromCol);
    const fromX = x + CELL / 2;
    const fromY = y + CELL / 2;

    const newMyHand = newState.hands[this.localNr] ?? [];
    const newLayout = this.computeHandLayout(newMyHand, true);
    const tl = newLayout.find(l => l.card.id === cbr.card.id);
    this.cbReturnAnim = {
      card: cbr.card,
      fromX, fromY,
      toX: tl?.cx ?? this.W / 2,
      toY: tl?.cy ?? MY_HAND_CY,
      startTime: performance.now(),
      done: false,
      isBlack: this.localNr === newState.blackPlayer,
      hiddenId: cbr.card.id,
    };
  }

  private drawCbReturnAnim(now: number) {
    if (!this.cbReturnAnim) return;
    const DURATION = 400;
    const t = Math.min((now - this.cbReturnAnim.startTime) / DURATION, 1);
    if (t >= 1) { this.cbReturnAnim.done = true; return; }

    const { card, fromX, fromY, toX, toY, isBlack } = this.cbReturnAnim;
    const px = fromX + (toX - fromX) * t;
    const py = fromY + (toY - fromY) * t;
    this.ctx.save();
    this.ctx.translate(px, py);
    this.drawCard(-CARD / 2, -CARD / 2, card, isBlack);
    this.ctx.restore();
  }

  setOppHover(idx: number | null) {
    this.oppHoverIdx = idx;
  }

  reset() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.state = null;
    this.drag = null;
    this.spinAnim = null;
    this.ghostSwapAnim = null;
    this.hellfireAnim = null;
    this.cbReturnAnim = null;
    this.lightningFlashAnims = [];
    this.scoreAnimMy = null;
    this.scoreAnimOpp = null;
    this.oppHoverIdx = null;
    this.lastHoverIdx = null;
    this.flipAnims = [];
    this.matchScore = {};
    this.ctx.clearRect(0, 0, this.W, this.H);
  }

  private start() {
    const loop = () => {
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  // Cards arc around a pivot point. Local hand: pivot below canvas, cards fan upward.
  // Opponent hand: pivot above canvas, cards fan downward toward center.
  private computeHandLayout(cards: Card[], isLocal: boolean): CardLayout[] {
    const N = cards.length;
    if (N === 0) return [];
    const pivotX = this.W / 2;
    const pivotY = isLocal ? MY_PIVOT_Y : OPP_PIVOT_Y;
    // Spread shrinks as cards are played — 8 cards = full spread, fewer = tighter.
    // N=2 gets a fixed narrow spread so the two cards slightly overlap.
    const spread = N <= 1 ? 0 : N === 2 ? (10 * Math.PI / 180) : FAN_HALF_ANGLE * 2 * Math.min(N / 8, 1);

    return cards.map((card, i) => {
      const t = N === 1 ? 0 : (i / (N - 1)) - 0.5; // −0.5 to +0.5
      const angle = t * spread;

      const cx = pivotX + FAN_RADIUS * Math.sin(angle);
      const cy = isLocal
        ? pivotY - FAN_RADIUS * Math.cos(angle)   // arcs upward from pivot below
        : pivotY + FAN_RADIUS * Math.cos(angle);  // arcs downward from pivot above

      const rotation = isLocal ? angle : Math.PI + angle;
      return { cx, cy, rotation, card };
    });
  }

  private cellPos(row: number, col: number) {
    return {
      x: this.gridX + col * (CELL + CELL_GAP),
      y: this.gridY + row * (CELL + CELL_GAP),
    };
  }

  // Inverse-rotate the mouse point into each card's local space, then AABB check.
  private hoveredHandCardIdx(): number | null {
    if (!this.state || !this.hoverPos || this.drag) return null;
    const { x: mx, y: my } = this.hoverPos;
    const hand = this.state.hands[this.localNr] ?? [];
    const layout = this.computeHandLayout(hand, true);
    for (let i = layout.length - 1; i >= 0; i--) {
      const { cx, cy, rotation } = layout[i];
      const dx = mx - cx, dy = my - cy;
      const cos = Math.cos(-rotation), sin = Math.sin(-rotation);
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      if (lx >= -CARD / 2 && lx < CARD / 2 && ly >= -CARD / 2 && ly < CARD / 2)
        return i;
    }
    return null;
  }

  private hoveredHandCardId(): string | null {
    const idx = this.hoveredHandCardIdx();
    if (idx === null || !this.state) return null;
    return (this.state.hands[this.localNr] ?? [])[idx]?.id ?? null;
  }

  private hitHandCard(mx: number, my: number): { layout: CardLayout; idx: number } | null {
    if (!this.state || this.state.currentTurn !== this.localNr || this.state.phase !== 'playing') {
      return null;
    }
    const hand = this.state.hands[this.localNr] ?? [];
    const layout = this.computeHandLayout(hand, true);

    for (let i = layout.length - 1; i >= 0; i--) {
      const { cx, cy, rotation } = layout[i];
      const dx = mx - cx;
      const dy = my - cy;
      const cos = Math.cos(-rotation);
      const sin = Math.sin(-rotation);
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      if (lx >= -CARD / 2 && lx < CARD / 2 && ly >= -CARD / 2 && ly < CARD / 2) {
        return { layout: layout[i], idx: i };
      }
    }
    return null;
  }

  private hitCell(mx: number, my: number): { row: number; col: number } | null {
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const { x, y } = this.cellPos(row, col);
        if (mx >= x && mx < x + CELL && my >= y && my < y + CELL) {
          return { row, col };
        }
      }
    }
    return null;
  }

  private isNearFire(row: number, col: number): boolean {
    if (!this.state) return false;
    const board = this.state.board;
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]] as [number,number][]) {
      const nr = row + dr; const nc = col + dc;
      if (nr < 0 || nr >= 4 || nc < 0 || nc >= 4) continue;
      const cell = board[nr][nc];
      if (cell && 'card' in cell && cell.card.type === 'fire') return true;
    }
    return false;
  }

  // A cell is fogged for localNr if any touching cell has a fog card owned by the opponent.
  // Computed dynamically so stale fogged state (e.g. after moon flip or succubus move) can't mislead.
  private isFoggedFor(row: number, col: number): boolean {
    if (!this.state) return false;
    const board = this.state.board;
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]] as [number,number][]) {
      const nr = row + dr; const nc = col + dc;
      if (nr < 0 || nr >= 4 || nc < 0 || nc >= 4) continue;
      const cell = board[nr][nc];
      if (cell && 'card' in cell && cell.card.type === 'fog' && cell.owner !== this.localNr) return true;
    }
    return false;
  }

  // Mirrors oni placement logic in gameLogic.ts — returns the cells where hands will land.
  private oniHandCells(row: number, col: number): { row: number; col: number; emoji: string; angle: number; dir: Direction }[] {
    if (!this.state) return [];
    const board = this.state.board;
    const toPlace: { row: number; col: number; emoji: string; angle: number; dir: Direction }[] = [];
    const remaining: ('🫳' | '🫴')[] = ['🫳', '🫴'];

    const preferred: [[number, number], '🫳' | '🫴', number, Direction][] = [
      [[row, col - 1], '🫳', -Math.PI / 2, 'up'],
      [[row, col + 1], '🫴', -Math.PI / 2, 'up'],
    ];
    for (const [[er, ec], emoji, angle, dir] of preferred) {
      if (toPlace.length >= 2) break;
      if (er < 0 || er >= 4 || ec < 0 || ec >= 4 || board[er][ec]) continue;
      toPlace.push({ row: er, col: ec, emoji, angle, dir });
      remaining.splice(remaining.indexOf(emoji), 1);
    }

    const fallbackFor: Record<'🫳' | '🫴', [[number, number], number, Direction][]> = {
      '🫳': [
        [[row - 1, col - 1], -Math.PI / 4,       'up-right'],
        [[row + 1, col - 1], -3 * Math.PI / 4,   'up-left'],
        [[row - 1, col],      0,                  'right'],
        [[row + 1, col],      Math.PI,             'left'],
        [[row - 1, col + 1],  Math.PI / 4,        'down-right'],
        [[row + 1, col + 1],  3 * Math.PI / 4,   'down-left'],
        [[row,     col + 1], -Math.PI / 2,        'up'],
      ],
      '🫴': [
        [[row - 1, col + 1], -3 * Math.PI / 4,   'up-left'],
        [[row + 1, col + 1], -Math.PI / 4,        'up-right'],
        [[row - 1, col],      Math.PI,             'left'],
        [[row + 1, col],      0,                  'right'],
        [[row - 1, col - 1],  3 * Math.PI / 4,   'down-left'],
        [[row + 1, col - 1],  Math.PI / 4,        'down-right'],
        [[row,     col - 1], -Math.PI / 2,        'up'],
      ],
    };
    for (const emoji of [...remaining] as ('🫳' | '🫴')[]) {
      for (const [[er, ec], angle, dir] of fallbackFor[emoji]) {
        if (er < 0 || er >= 4 || ec < 0 || ec >= 4 || board[er][ec]) continue;
        if (toPlace.some(p => p.row === er && p.col === ec)) continue;
        toPlace.push({ row: er, col: ec, emoji, angle, dir });
        break;
      }
    }

    return toPlace;
  }

  private findHoveredCard(mx: number, my: number): Card | null {
    if (!this.state) return null;

    // Board cells — skip fogged opponent cards (face-down, unreadable)
    const cell = this.hitCell(mx, my);
    if (cell) {
      const bc = this.state.board[cell.row][cell.col];
      const hiddenFog = bc && 'card' in bc && this.isFoggedFor(cell.row, cell.col) && !this.isNearFire(cell.row, cell.col);
      if (bc && 'card' in bc && !hiddenFog) return bc.card;
    }

    // Helper: inverse-rotate hit test for a fan layout
    const hitFan = (layout: CardLayout[]) => {
      for (let i = layout.length - 1; i >= 0; i--) {
        const { cx, cy, rotation } = layout[i];
        const dx = mx - cx; const dy = my - cy;
        const cos = Math.cos(-rotation); const sin = Math.sin(-rotation);
        const lx = dx * cos - dy * sin;
        const ly = dx * sin + dy * cos;
        if (lx >= -CARD / 2 && lx < CARD / 2 && ly >= -CARD / 2 && ly < CARD / 2)
          return layout[i].card;
      }
      return null;
    };

    // My hand
    const myHand = this.state.hands[this.localNr] ?? [];
    const myHit = hitFan(this.computeHandLayout(myHand, true));
    if (myHit) return myHit;

    // Opp hand — only when revealed by eye
    const myEyeActive = this.state.board.flat().some(
      c => c && 'card' in c && c.owner === this.localNr && c.card.type === 'eye'
    );
    if (myEyeActive) {
      const oppNr = Object.keys(this.state.hands).map(Number).find(n => n !== this.localNr);
      if (oppNr !== undefined) {
        const oppHand = this.state.hands[oppNr] ?? [];
        const oppHit = hitFan(this.computeHandLayout(oppHand, false));
        if (oppHit) return oppHit;
      }
    }

    return null;
  }

  private onMouseDown = (e: MouseEvent) => {
    if (this.spinAnim && !this.spinAnim.done) return;
    const b = this.canvas.getBoundingClientRect();
    const hit = this.hitHandCard(e.clientX - b.left, e.clientY - b.top);
    if (hit) this.drag = { card: hit.layout.card, x: e.clientX - b.left, y: e.clientY - b.top };
  };

  private onMouseMove = (e: MouseEvent) => {
    const b = this.canvas.getBoundingClientRect();
    const mx = e.clientX - b.left;
    const my = e.clientY - b.top;
    this.hoverPos = { x: mx, y: my };
    if (this.drag) { this.drag.x = mx; this.drag.y = my; }
    const idx = this.hoveredHandCardIdx();
    if (idx !== this.lastHoverIdx) {
      this.lastHoverIdx = idx;
      this.onHoverChange?.(idx);
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (!this.drag || !this.state) { this.drag = null; return; }
    const b = this.canvas.getBoundingClientRect();
    const cell = this.hitCell(e.clientX - b.left, e.clientY - b.top);
    if (cell) {
      const target = this.state.board[cell.row][cell.col];
      const isBlood = target !== null && 'blood' in target;
      const isCard = target !== null && !isBlood;
      const validDrop = target === null || (this.drag.card.type === 'bandage' && isBlood) || (this.drag.card.type === 'web' && isCard);
      if (validDrop) this.onPlaceCard?.(this.drag.card.id, cell.row, cell.col);
    }
    this.drag = null;
  };

  private drawFoilOverlay(x: number, y: number) {
    const ctx = this.ctx;
    const now = performance.now();
    const cx = x + CARD / 2;
    const cy = y + CARD / 2;

    // Slowly rotating rainbow gradient
    const angle = (now / 3000) * Math.PI * 2;
    const r = CARD;
    const grad = ctx.createLinearGradient(
      cx + Math.cos(angle) * r, cy + Math.sin(angle) * r,
      cx - Math.cos(angle) * r, cy - Math.sin(angle) * r,
    );
    grad.addColorStop(0,   'rgba(255,  20, 120, 0.30)');
    grad.addColorStop(0.2, 'rgba(255, 140,   0, 0.30)');
    grad.addColorStop(0.4, 'rgba(200, 255,   0, 0.30)');
    grad.addColorStop(0.6, 'rgba(  0, 255, 160, 0.30)');
    grad.addColorStop(0.8, 'rgba(  0, 140, 255, 0.30)');
    grad.addColorStop(1,   'rgba(180,   0, 255, 0.30)');

    // Sweeping white sheen
    const sheenPos = ((now / 1800) % 1.6) - 0.3;
    const sx = x + sheenPos * CARD;
    const sheen = ctx.createLinearGradient(sx, y, sx + CARD * 0.45, y);
    sheen.addColorStop(0,   'rgba(255,255,255,0)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0.18)');
    sheen.addColorStop(1,   'rgba(255,255,255,0)');

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, CARD, CARD, 6);
    ctx.clip();
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, CARD, CARD);
    ctx.fillStyle = sheen;
    ctx.fillRect(x, y, CARD, CARD);
    ctx.restore();
  }

  private drawZombifiedOverlay(x: number, y: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, CARD, CARD, 6);
    ctx.clip();
    ctx.fillStyle = 'rgba(80, 110, 80, 0.60)';
    ctx.fillRect(x, y, CARD, CARD);
    ctx.restore();
  }

  private drawGhostSwapCards(now: number) {
    if (!this.ghostSwapAnim) return;
    const DURATION = 1350;
    const TRAVEL   = 0.6; // 0–60% travel, 60–100% flip
    const t = Math.min((now - this.ghostSwapAnim.startTime) / DURATION, 1);
    if (t >= 1) { this.ghostSwapAnim.done = true; return; }

    const { ctx } = this;
    for (const sc of this.ghostSwapAnim.cards) {
      const flyT  = Math.min(t / TRAVEL, 1);
      const flipT = flyT >= 1 ? (t - TRAVEL) / (1 - TRAVEL) : 0;

      // cubic ease-in-out for travel
      const fe = flyT < 0.5 ? 4 * flyT ** 3 : 1 - (-2 * flyT + 2) ** 3 / 2;
      const px  = sc.fromX + (sc.toX - sc.fromX) * fe;
      const py  = sc.fromY + (sc.toY - sc.fromY) * fe;
      const rot = sc.fromRotation + (sc.toRotation - sc.fromRotation) * fe;

      let scaleX   = 1;
      let faceDown = sc.startFaceDown;
      let isBlack  = sc.startIsBlack;
      if (flipT > 0) {
        if (flipT < 0.5) {
          scaleX = Math.max(0, 1 - flipT * 2);
        } else {
          scaleX   = (flipT - 0.5) * 2;
          faceDown = !sc.startFaceDown;
          isBlack  = sc.endIsBlack;
        }
      }

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rot);
      ctx.scale(scaleX, 1);
      this.drawCard(-CARD / 2, -CARD / 2, sc.card, isBlack, faceDown);
      ctx.restore();
    }
  }

  private drawCard(x: number, y: number, card: Card, isBlack: boolean, faceDown = false) {
    const ctx = this.ctx;

    if (faceDown) {
      ctx.beginPath();
      ctx.roundRect(x, y, CARD, CARD, 6);
      ctx.fillStyle = '#7349ac';
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = '#5a3090';
      ctx.lineWidth = 1;
      for (let d = -CARD; d < CARD * 2; d += 10) {
        ctx.beginPath();
        ctx.moveTo(x + d, y);
        ctx.lineTo(x + d + CARD, y + CARD);
        ctx.stroke();
      }
      ctx.restore();
      ctx.beginPath();
      ctx.roundRect(x, y, CARD, CARD, 6);
      ctx.strokeStyle = '#9060cc';
      ctx.lineWidth = 1;
      ctx.stroke();
      return;
    }

    const bg = isBlack ? '#111111' : '#f0f0f0';
    const fg = isBlack ? '#eeeeee' : '#111111';
    const border = isBlack ? '#333333' : '#cccccc';

    ctx.beginPath();
    ctx.roundRect(x, y, CARD, CARD, 6);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.stroke();

    const cx = x + CARD / 2;
    const cy = y + CARD / 2;
    const m = 6;
    const ts = 4;

    if (card.type === 'heart') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const hm = ctx.measureText('🫀');
      ctx.fillText('🫀', 0, (hm.actualBoundingBoxAscent - hm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      // Four outward triangles — signals all-direction capture
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.moveTo(cx, y + m); ctx.lineTo(cx - ts, y + m + ts * 1.5); ctx.lineTo(cx + ts, y + m + ts * 1.5); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx, y + CARD - m); ctx.lineTo(cx - ts, y + CARD - m - ts * 1.5); ctx.lineTo(cx + ts, y + CARD - m - ts * 1.5); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + m, cy); ctx.lineTo(x + m + ts * 1.5, cy - ts); ctx.lineTo(x + m + ts * 1.5, cy + ts); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + CARD - m, cy); ctx.lineTo(x + CARD - m - ts * 1.5, cy - ts); ctx.lineTo(x + CARD - m - ts * 1.5, cy + ts); ctx.fill();
      return;
    }

    if (card.type === 'eye') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const em = ctx.measureText('👁️');
      ctx.fillText('👁️', 0, (em.actualBoundingBoxAscent - em.actualBoundingBoxDescent) / 2);
      ctx.restore();
      return;
    }

    if (card.type === 'tooth') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const tm = ctx.measureText('🦷');
      ctx.fillText('🦷', 0, (tm.actualBoundingBoxAscent - tm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      return;
    }

    if (card.type === 'moon') {
      this.drawFoilOverlay(x, y);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const mm = ctx.measureText('🌕');
      ctx.fillText('🌕', 0, (mm.actualBoundingBoxAscent - mm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      return;
    }

    if (card.type === 'mirror') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const mr = ctx.measureText('🪞');
      ctx.fillText('🪞', 0, (mr.actualBoundingBoxAscent - mr.actualBoundingBoxDescent) / 2);
      ctx.restore();
      return;
    }

    if (card.type === 'bandage') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const bm = ctx.measureText('🩹');
      ctx.fillText('🩹', 0, (bm.actualBoundingBoxAscent - bm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      // Left and right capture indicators
      const m = 6; const ts = 4;
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.moveTo(x + m, cy);
      ctx.lineTo(x + m + ts * 1.5, cy - ts);
      ctx.lineTo(x + m + ts * 1.5, cy + ts);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + CARD - m, cy);
      ctx.lineTo(x + CARD - m - ts * 1.5, cy - ts);
      ctx.lineTo(x + CARD - m - ts * 1.5, cy + ts);
      ctx.fill();
      return;
    }

    if (card.type === 'vampire') {
      this.drawFoilOverlay(x, y);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const vm = ctx.measureText('🧛');
      ctx.fillText('🧛', 0, (vm.actualBoundingBoxAscent - vm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      // Diagonal-down indicators at bottom-left and bottom-right corners
      const m = 7; const ts = 4;
      ctx.fillStyle = fg;
      ctx.beginPath(); // bottom-left corner → points ↙
      ctx.moveTo(x + m, y + CARD - m);
      ctx.lineTo(x + m + ts * 1.5, y + CARD - m);
      ctx.lineTo(x + m, y + CARD - m - ts * 1.5);
      ctx.fill();
      ctx.beginPath(); // bottom-right corner → points ↘
      ctx.moveTo(x + CARD - m, y + CARD - m);
      ctx.lineTo(x + CARD - m - ts * 1.5, y + CARD - m);
      ctx.lineTo(x + CARD - m, y + CARD - m - ts * 1.5);
      ctx.fill();
      return;
    }

    if (card.type === 'wolf') {
      const moonIsOut = this.state?.board.flat().some(c => c && 'card' in c && c.card.type === 'moon') ?? false;
      if (moonIsOut) this.drawFoilOverlay(x, y);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const wm = ctx.measureText('🐺');
      ctx.fillText('🐺', 0, (wm.actualBoundingBoxAscent - wm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      const mc = 7; const ts = 4;
      ctx.fillStyle = fg;
      if (moonIsOut) {
        // Cardinal indicators — werewolf mode
        ctx.beginPath(); ctx.moveTo(cx, y + m); ctx.lineTo(cx - ts, y + m + ts * 1.5); ctx.lineTo(cx + ts, y + m + ts * 1.5); ctx.fill();
        ctx.beginPath(); ctx.moveTo(cx, y + CARD - m); ctx.lineTo(cx - ts, y + CARD - m - ts * 1.5); ctx.lineTo(cx + ts, y + CARD - m - ts * 1.5); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x + m, cy); ctx.lineTo(x + m + ts * 1.5, cy - ts); ctx.lineTo(x + m + ts * 1.5, cy + ts); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x + CARD - m, cy); ctx.lineTo(x + CARD - m - ts * 1.5, cy - ts); ctx.lineTo(x + CARD - m - ts * 1.5, cy + ts); ctx.fill();
      } else {
        // Corner indicators — diagonal captures
        ctx.beginPath(); ctx.moveTo(x + mc, y + mc); ctx.lineTo(x + mc + ts * 1.5, y + mc); ctx.lineTo(x + mc, y + mc + ts * 1.5); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x + CARD - mc, y + mc); ctx.lineTo(x + CARD - mc - ts * 1.5, y + mc); ctx.lineTo(x + CARD - mc, y + mc + ts * 1.5); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x + mc, y + CARD - mc); ctx.lineTo(x + mc + ts * 1.5, y + CARD - mc); ctx.lineTo(x + mc, y + CARD - mc - ts * 1.5); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x + CARD - mc, y + CARD - mc); ctx.lineTo(x + CARD - mc - ts * 1.5, y + CARD - mc); ctx.lineTo(x + CARD - mc, y + CARD - mc - ts * 1.5); ctx.fill();
      }
      return;
    }

    if (card.type === 'squid') {
      this.drawFoilOverlay(x, y);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const sqm = ctx.measureText('🦑');
      ctx.fillText('🦑', 0, (sqm.actualBoundingBoxAscent - sqm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.moveTo(x + m, cy); ctx.lineTo(x + m + ts * 1.5, cy - ts); ctx.lineTo(x + m + ts * 1.5, cy + ts); ctx.fill(); // left
      ctx.beginPath(); ctx.moveTo(x + CARD - m, cy); ctx.lineTo(x + CARD - m - ts * 1.5, cy - ts); ctx.lineTo(x + CARD - m - ts * 1.5, cy + ts); ctx.fill(); // right
      ctx.beginPath(); ctx.moveTo(x + m, y + CARD - m); ctx.lineTo(x + m + ts * 1.5, y + CARD - m); ctx.lineTo(x + m, y + CARD - m - ts * 1.5); ctx.fill(); // down-left
      ctx.beginPath(); ctx.moveTo(x + CARD - m, y + CARD - m); ctx.lineTo(x + CARD - m - ts * 1.5, y + CARD - m); ctx.lineTo(x + CARD - m, y + CARD - m - ts * 1.5); ctx.fill(); // down-right
      return;
    }

    if (card.type === 'mermaid') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const mrm = ctx.measureText('🧜');
      ctx.fillText('🧜', 0, (mrm.actualBoundingBoxAscent - mrm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.moveTo(x + m, cy); ctx.lineTo(x + m + ts * 1.5, cy - ts); ctx.lineTo(x + m + ts * 1.5, cy + ts); ctx.fill(); // left
      ctx.beginPath(); ctx.moveTo(x + m, y + m); ctx.lineTo(x + m + ts * 1.5, y + m); ctx.lineTo(x + m, y + m + ts * 1.5); ctx.fill(); // up-left corner
      ctx.beginPath(); ctx.moveTo(cx, y + m); ctx.lineTo(cx - ts, y + m + ts * 1.5); ctx.lineTo(cx + ts, y + m + ts * 1.5); ctx.fill(); // up
      return;
    }

    if (card.type === 'bubbles') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const bbm = ctx.measureText('🫧');
      ctx.fillText('🫧', 0, (bbm.actualBoundingBoxAscent - bbm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      return;
    }

    if (card.type === 'zombie') {
      this.drawFoilOverlay(x, y);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const zm = ctx.measureText('🧟');
      ctx.fillText('🧟', 0, (zm.actualBoundingBoxAscent - zm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      ctx.fillStyle = fg;
      // All 8 touching indicators
      ctx.beginPath(); ctx.moveTo(cx, y + m); ctx.lineTo(cx - ts, y + m + ts * 1.5); ctx.lineTo(cx + ts, y + m + ts * 1.5); ctx.fill(); // up
      ctx.beginPath(); ctx.moveTo(cx, y + CARD - m); ctx.lineTo(cx - ts, y + CARD - m - ts * 1.5); ctx.lineTo(cx + ts, y + CARD - m - ts * 1.5); ctx.fill(); // down
      ctx.beginPath(); ctx.moveTo(x + m, cy); ctx.lineTo(x + m + ts * 1.5, cy - ts); ctx.lineTo(x + m + ts * 1.5, cy + ts); ctx.fill(); // left
      ctx.beginPath(); ctx.moveTo(x + CARD - m, cy); ctx.lineTo(x + CARD - m - ts * 1.5, cy - ts); ctx.lineTo(x + CARD - m - ts * 1.5, cy + ts); ctx.fill(); // right
      const mc = 7;
      ctx.beginPath(); ctx.moveTo(x + mc, y + mc); ctx.lineTo(x + mc + ts * 1.5, y + mc); ctx.lineTo(x + mc, y + mc + ts * 1.5); ctx.fill(); // up-left
      ctx.beginPath(); ctx.moveTo(x + CARD - mc, y + mc); ctx.lineTo(x + CARD - mc - ts * 1.5, y + mc); ctx.lineTo(x + CARD - mc, y + mc + ts * 1.5); ctx.fill(); // up-right
      ctx.beginPath(); ctx.moveTo(x + mc, y + CARD - mc); ctx.lineTo(x + mc + ts * 1.5, y + CARD - mc); ctx.lineTo(x + mc, y + CARD - mc - ts * 1.5); ctx.fill(); // down-left
      ctx.beginPath(); ctx.moveTo(x + CARD - mc, y + CARD - mc); ctx.lineTo(x + CARD - mc - ts * 1.5, y + CARD - mc); ctx.lineTo(x + CARD - mc, y + CARD - mc - ts * 1.5); ctx.fill(); // down-right
      return;
    }

    if (card.type === 'brain') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const brm = ctx.measureText('🧠');
      ctx.fillText('🧠', 0, (brm.actualBoundingBoxAscent - brm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.moveTo(x + m, cy); ctx.lineTo(x + m + ts * 1.5, cy - ts); ctx.lineTo(x + m + ts * 1.5, cy + ts); ctx.fill(); // left
      ctx.beginPath(); ctx.moveTo(x + CARD - m, cy); ctx.lineTo(x + CARD - m - ts * 1.5, cy - ts); ctx.lineTo(x + CARD - m - ts * 1.5, cy + ts); ctx.fill(); // right
      ctx.beginPath(); ctx.moveTo(cx, y + CARD - m); ctx.lineTo(cx - ts, y + CARD - m - ts * 1.5); ctx.lineTo(cx + ts, y + CARD - m - ts * 1.5); ctx.fill(); // down
      return;
    }

    if (card.type === 'gravestone') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const gvm = ctx.measureText('🪦');
      ctx.fillText('🪦', 0, (gvm.actualBoundingBoxAscent - gvm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      return;
    }

    if (card.type === 'skull') {
      this.drawFoilOverlay(x, y);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const skm = ctx.measureText('💀');
      ctx.fillText('💀', 0, (skm.actualBoundingBoxAscent - skm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.moveTo(x + m, cy); ctx.lineTo(x + m + ts * 1.5, cy - ts); ctx.lineTo(x + m + ts * 1.5, cy + ts); ctx.fill(); // left
      ctx.beginPath(); ctx.moveTo(x + CARD - m, cy); ctx.lineTo(x + CARD - m - ts * 1.5, cy - ts); ctx.lineTo(x + CARD - m - ts * 1.5, cy + ts); ctx.fill(); // right
      ctx.beginPath(); ctx.moveTo(cx, y + m); ctx.lineTo(cx - ts, y + m + ts * 1.5); ctx.lineTo(cx + ts, y + m + ts * 1.5); ctx.fill(); // up
      return;
    }

    if (card.type === 'bone') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(card.direction === 'up-right' ? 0 : Math.PI / 2);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const bom = ctx.measureText('🦴');
      ctx.fillText('🦴', 0, (bom.actualBoundingBoxAscent - bom.actualBoundingBoxDescent) / 2);
      ctx.restore();
      const mc = 7;
      ctx.fillStyle = fg;
      if (card.direction === 'up-right') {
        ctx.beginPath(); ctx.moveTo(x + CARD - mc, y + mc); ctx.lineTo(x + CARD - mc - ts * 1.5, y + mc); ctx.lineTo(x + CARD - mc, y + mc + ts * 1.5); ctx.fill(); // up-right
        ctx.beginPath(); ctx.moveTo(x + mc, y + CARD - mc); ctx.lineTo(x + mc + ts * 1.5, y + CARD - mc); ctx.lineTo(x + mc, y + CARD - mc - ts * 1.5); ctx.fill(); // down-left
      } else {
        ctx.beginPath(); ctx.moveTo(x + mc, y + mc); ctx.lineTo(x + mc + ts * 1.5, y + mc); ctx.lineTo(x + mc, y + mc + ts * 1.5); ctx.fill(); // up-left
        ctx.beginPath(); ctx.moveTo(x + CARD - mc, y + CARD - mc); ctx.lineTo(x + CARD - mc - ts * 1.5, y + CARD - mc); ctx.lineTo(x + CARD - mc, y + CARD - mc - ts * 1.5); ctx.fill(); // down-right
      }
      return;
    }

    if (card.type === 'hand') {
      const emoji = card.summonedHand?.emoji ?? '🫴';
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(card.summonedHand?.angle ?? 0);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emoji, 0, 0);
      ctx.restore();
      // Direction indicator — same corner/edge triangle logic as knife
      ctx.fillStyle = fg;
      ctx.beginPath();
      switch (card.direction) {
        case 'up':         ctx.moveTo(cx, y + m); ctx.lineTo(cx - ts, y + m + ts * 1.5); ctx.lineTo(cx + ts, y + m + ts * 1.5); break;
        case 'down':       ctx.moveTo(cx, y + CARD - m); ctx.lineTo(cx - ts, y + CARD - m - ts * 1.5); ctx.lineTo(cx + ts, y + CARD - m - ts * 1.5); break;
        case 'left':       ctx.moveTo(x + m, cy); ctx.lineTo(x + m + ts * 1.5, cy - ts); ctx.lineTo(x + m + ts * 1.5, cy + ts); break;
        case 'right':      ctx.moveTo(x + CARD - m, cy); ctx.lineTo(x + CARD - m - ts * 1.5, cy - ts); ctx.lineTo(x + CARD - m - ts * 1.5, cy + ts); break;
        case 'up-left':    ctx.moveTo(x + m, y + m); ctx.lineTo(x + m + ts * 1.5, y + m); ctx.lineTo(x + m, y + m + ts * 1.5); break;
        case 'up-right':   ctx.moveTo(x + CARD - m, y + m); ctx.lineTo(x + CARD - m - ts * 1.5, y + m); ctx.lineTo(x + CARD - m, y + m + ts * 1.5); break;
        case 'down-left':  ctx.moveTo(x + m, y + CARD - m); ctx.lineTo(x + m + ts * 1.5, y + CARD - m); ctx.lineTo(x + m, y + CARD - m - ts * 1.5); break;
        case 'down-right': ctx.moveTo(x + CARD - m, y + CARD - m); ctx.lineTo(x + CARD - m - ts * 1.5, y + CARD - m); ctx.lineTo(x + CARD - m, y + CARD - m - ts * 1.5); break;
      }
      ctx.fill();
      return;
    }

    if (card.type === 'troll') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const trm = ctx.measureText('🧌');
      ctx.fillText('🧌', 0, (trm.actualBoundingBoxAscent - trm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.moveTo(cx, y + m); ctx.lineTo(cx - ts, y + m + ts * 1.5); ctx.lineTo(cx + ts, y + m + ts * 1.5); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx, y + CARD - m); ctx.lineTo(cx - ts, y + CARD - m - ts * 1.5); ctx.lineTo(cx + ts, y + CARD - m - ts * 1.5); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + m, cy); ctx.lineTo(x + m + ts * 1.5, cy - ts); ctx.lineTo(x + m + ts * 1.5, cy + ts); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + CARD - m, cy); ctx.lineTo(x + CARD - m - ts * 1.5, cy - ts); ctx.lineTo(x + CARD - m - ts * 1.5, cy + ts); ctx.fill();
      return;
    }

    if (card.type === 'dragon') {
      this.drawFoilOverlay(x, y);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const drm = ctx.measureText('🐲');
      ctx.fillText('🐲', 0, (drm.actualBoundingBoxAscent - drm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      // Direction indicator + a second smaller triangle further along the line, suggesting pierce
      ctx.fillStyle = fg;
      const ts2 = ts * 0.7;
      switch (card.direction) {
        case 'up': {
          ctx.beginPath(); ctx.moveTo(cx, y + m); ctx.lineTo(cx - ts, y + m + ts * 1.5); ctx.lineTo(cx + ts, y + m + ts * 1.5); ctx.fill();
          ctx.beginPath(); ctx.moveTo(cx, y + m + ts * 2.5); ctx.lineTo(cx - ts2, y + m + ts * 2.5 + ts2 * 1.5); ctx.lineTo(cx + ts2, y + m + ts * 2.5 + ts2 * 1.5); ctx.fill();
          break;
        }
        case 'down': {
          ctx.beginPath(); ctx.moveTo(cx, y + CARD - m); ctx.lineTo(cx - ts, y + CARD - m - ts * 1.5); ctx.lineTo(cx + ts, y + CARD - m - ts * 1.5); ctx.fill();
          ctx.beginPath(); ctx.moveTo(cx, y + CARD - m - ts * 2.5); ctx.lineTo(cx - ts2, y + CARD - m - ts * 2.5 - ts2 * 1.5); ctx.lineTo(cx + ts2, y + CARD - m - ts * 2.5 - ts2 * 1.5); ctx.fill();
          break;
        }
        case 'left': {
          ctx.beginPath(); ctx.moveTo(x + m, cy); ctx.lineTo(x + m + ts * 1.5, cy - ts); ctx.lineTo(x + m + ts * 1.5, cy + ts); ctx.fill();
          ctx.beginPath(); ctx.moveTo(x + m + ts * 2.5, cy); ctx.lineTo(x + m + ts * 2.5 + ts2 * 1.5, cy - ts2); ctx.lineTo(x + m + ts * 2.5 + ts2 * 1.5, cy + ts2); ctx.fill();
          break;
        }
        case 'right': {
          ctx.beginPath(); ctx.moveTo(x + CARD - m, cy); ctx.lineTo(x + CARD - m - ts * 1.5, cy - ts); ctx.lineTo(x + CARD - m - ts * 1.5, cy + ts); ctx.fill();
          ctx.beginPath(); ctx.moveTo(x + CARD - m - ts * 2.5, cy); ctx.lineTo(x + CARD - m - ts * 2.5 - ts2 * 1.5, cy - ts2); ctx.lineTo(x + CARD - m - ts * 2.5 - ts2 * 1.5, cy + ts2); ctx.fill();
          break;
        }
        case 'up-left': { const mc=7;
          ctx.beginPath(); ctx.moveTo(x+mc,y+mc); ctx.lineTo(x+mc+ts*1.5,y+mc); ctx.lineTo(x+mc,y+mc+ts*1.5); ctx.fill();
          ctx.beginPath(); ctx.moveTo(x+mc+ts*2,y+mc+ts*2); ctx.lineTo(x+mc+ts*2+ts2*1.5,y+mc+ts*2); ctx.lineTo(x+mc+ts*2,y+mc+ts*2+ts2*1.5); ctx.fill();
          break;
        }
        case 'up-right': { const mc=7;
          ctx.beginPath(); ctx.moveTo(x+CARD-mc,y+mc); ctx.lineTo(x+CARD-mc-ts*1.5,y+mc); ctx.lineTo(x+CARD-mc,y+mc+ts*1.5); ctx.fill();
          ctx.beginPath(); ctx.moveTo(x+CARD-mc-ts*2,y+mc+ts*2); ctx.lineTo(x+CARD-mc-ts*2-ts2*1.5,y+mc+ts*2); ctx.lineTo(x+CARD-mc-ts*2,y+mc+ts*2+ts2*1.5); ctx.fill();
          break;
        }
        case 'down-left': { const mc=7;
          ctx.beginPath(); ctx.moveTo(x+mc,y+CARD-mc); ctx.lineTo(x+mc+ts*1.5,y+CARD-mc); ctx.lineTo(x+mc,y+CARD-mc-ts*1.5); ctx.fill();
          ctx.beginPath(); ctx.moveTo(x+mc+ts*2,y+CARD-mc-ts*2); ctx.lineTo(x+mc+ts*2+ts2*1.5,y+CARD-mc-ts*2); ctx.lineTo(x+mc+ts*2,y+CARD-mc-ts*2-ts2*1.5); ctx.fill();
          break;
        }
        case 'down-right': { const mc=7;
          ctx.beginPath(); ctx.moveTo(x+CARD-mc,y+CARD-mc); ctx.lineTo(x+CARD-mc-ts*1.5,y+CARD-mc); ctx.lineTo(x+CARD-mc,y+CARD-mc-ts*1.5); ctx.fill();
          ctx.beginPath(); ctx.moveTo(x+CARD-mc-ts*2,y+CARD-mc-ts*2); ctx.lineTo(x+CARD-mc-ts*2-ts2*1.5,y+CARD-mc-ts*2); ctx.lineTo(x+CARD-mc-ts*2,y+CARD-mc-ts*2-ts2*1.5); ctx.fill();
          break;
        }
      }
      return;
    }

    if (card.type === 'alien') {
      this.drawFoilOverlay(x, y);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const alm = ctx.measureText('👾');
      ctx.fillText('👾', 0, (alm.actualBoundingBoxAscent - alm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      // Eight small dots at proportional knight-move offsets within the card
      const step = CARD / 3;
      ctx.fillStyle = fg;
      for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
        const kx = cx + dc * step / 2;
        const ky = cy + dr * step / 2;
        if (kx < x + 3 || kx > x + CARD - 3 || ky < y + 3 || ky > y + CARD - 3) continue;
        ctx.beginPath();
        ctx.arc(kx, ky, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }

    if (card.type === 'imp') {
      this.drawFoilOverlay(x, y);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const im = ctx.measureText('👿');
      ctx.fillText('👿', 0, (im.actualBoundingBoxAscent - im.actualBoundingBoxDescent) / 2);
      ctx.restore();
      // Two upper-corner triangles — captures diagonally upward (2 squares)
      ctx.fillStyle = fg;
      const mc = 7;
      ctx.beginPath(); ctx.moveTo(x + mc, y + mc); ctx.lineTo(x + mc + ts * 1.5, y + mc); ctx.lineTo(x + mc, y + mc + ts * 1.5); ctx.fill(); // up-left
      ctx.beginPath(); ctx.moveTo(x + CARD - mc, y + mc); ctx.lineTo(x + CARD - mc - ts * 1.5, y + mc); ctx.lineTo(x + CARD - mc, y + mc + ts * 1.5); ctx.fill(); // up-right
      return;
    }

    if (card.type === 'hellfire') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.filter = 'hue-rotate(120deg)';
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const hfm = ctx.measureText('🔥');
      ctx.fillText('🔥', 0, (hfm.actualBoundingBoxAscent - hfm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.moveTo(cx, y + m); ctx.lineTo(cx - ts, y + m + ts * 1.5); ctx.lineTo(cx + ts, y + m + ts * 1.5); ctx.fill(); // up
      ctx.beginPath(); ctx.moveTo(cx, y + CARD - m); ctx.lineTo(cx - ts, y + CARD - m - ts * 1.5); ctx.lineTo(cx + ts, y + CARD - m - ts * 1.5); ctx.fill(); // down
      ctx.beginPath(); ctx.moveTo(x + m, cy); ctx.lineTo(x + m + ts * 1.5, cy - ts); ctx.lineTo(x + m + ts * 1.5, cy + ts); ctx.fill(); // left
      ctx.beginPath(); ctx.moveTo(x + CARD - m, cy); ctx.lineTo(x + CARD - m - ts * 1.5, cy - ts); ctx.lineTo(x + CARD - m - ts * 1.5, cy + ts); ctx.fill(); // right
      { const mc = 7;
        ctx.beginPath(); ctx.moveTo(x + mc, y + mc); ctx.lineTo(x + mc + ts * 1.5, y + mc); ctx.lineTo(x + mc, y + mc + ts * 1.5); ctx.fill(); // up-left
        ctx.beginPath(); ctx.moveTo(x + CARD - mc, y + mc); ctx.lineTo(x + CARD - mc - ts * 1.5, y + mc); ctx.lineTo(x + CARD - mc, y + mc + ts * 1.5); ctx.fill(); // up-right
        ctx.beginPath(); ctx.moveTo(x + mc, y + CARD - mc); ctx.lineTo(x + mc + ts * 1.5, y + CARD - mc); ctx.lineTo(x + mc, y + CARD - mc - ts * 1.5); ctx.fill(); // down-left
        ctx.beginPath(); ctx.moveTo(x + CARD - mc, y + CARD - mc); ctx.lineTo(x + CARD - mc - ts * 1.5, y + CARD - mc); ctx.lineTo(x + CARD - mc, y + CARD - mc - ts * 1.5); ctx.fill(); // down-right
      }
      return;
    }

    if (card.type === 'snake') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const snm = ctx.measureText('🐍');
      ctx.fillText('🐍', 0, (snm.actualBoundingBoxAscent - snm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      // Dragon-style double arrow at both ends of the capture axis
      ctx.fillStyle = fg;
      const mc = 7; const ts2 = ts * 0.7;
      switch (card.direction) {
        case 'up': case 'down':
          ctx.beginPath(); ctx.moveTo(cx, y + m); ctx.lineTo(cx - ts, y + m + ts * 1.5); ctx.lineTo(cx + ts, y + m + ts * 1.5); ctx.fill();
          ctx.beginPath(); ctx.moveTo(cx, y + m + ts * 2.5); ctx.lineTo(cx - ts2, y + m + ts * 2.5 + ts2 * 1.5); ctx.lineTo(cx + ts2, y + m + ts * 2.5 + ts2 * 1.5); ctx.fill();
          ctx.beginPath(); ctx.moveTo(cx, y + CARD - m); ctx.lineTo(cx - ts, y + CARD - m - ts * 1.5); ctx.lineTo(cx + ts, y + CARD - m - ts * 1.5); ctx.fill();
          ctx.beginPath(); ctx.moveTo(cx, y + CARD - m - ts * 2.5); ctx.lineTo(cx - ts2, y + CARD - m - ts * 2.5 - ts2 * 1.5); ctx.lineTo(cx + ts2, y + CARD - m - ts * 2.5 - ts2 * 1.5); ctx.fill();
          break;
        case 'left': case 'right':
          ctx.beginPath(); ctx.moveTo(x + m, cy); ctx.lineTo(x + m + ts * 1.5, cy - ts); ctx.lineTo(x + m + ts * 1.5, cy + ts); ctx.fill();
          ctx.beginPath(); ctx.moveTo(x + m + ts * 2.5, cy); ctx.lineTo(x + m + ts * 2.5 + ts2 * 1.5, cy - ts2); ctx.lineTo(x + m + ts * 2.5 + ts2 * 1.5, cy + ts2); ctx.fill();
          ctx.beginPath(); ctx.moveTo(x + CARD - m, cy); ctx.lineTo(x + CARD - m - ts * 1.5, cy - ts); ctx.lineTo(x + CARD - m - ts * 1.5, cy + ts); ctx.fill();
          ctx.beginPath(); ctx.moveTo(x + CARD - m - ts * 2.5, cy); ctx.lineTo(x + CARD - m - ts * 2.5 - ts2 * 1.5, cy - ts2); ctx.lineTo(x + CARD - m - ts * 2.5 - ts2 * 1.5, cy + ts2); ctx.fill();
          break;
        case 'up-right': case 'down-left':
          ctx.beginPath(); ctx.moveTo(x+CARD-mc,y+mc); ctx.lineTo(x+CARD-mc-ts*1.5,y+mc); ctx.lineTo(x+CARD-mc,y+mc+ts*1.5); ctx.fill();
          ctx.beginPath(); ctx.moveTo(x+CARD-mc-ts*2,y+mc+ts*2); ctx.lineTo(x+CARD-mc-ts*2-ts2*1.5,y+mc+ts*2); ctx.lineTo(x+CARD-mc-ts*2,y+mc+ts*2+ts2*1.5); ctx.fill();
          ctx.beginPath(); ctx.moveTo(x+mc,y+CARD-mc); ctx.lineTo(x+mc+ts*1.5,y+CARD-mc); ctx.lineTo(x+mc,y+CARD-mc-ts*1.5); ctx.fill();
          ctx.beginPath(); ctx.moveTo(x+mc+ts*2,y+CARD-mc-ts*2); ctx.lineTo(x+mc+ts*2+ts2*1.5,y+CARD-mc-ts*2); ctx.lineTo(x+mc+ts*2,y+CARD-mc-ts*2-ts2*1.5); ctx.fill();
          break;
        case 'up-left': case 'down-right':
          ctx.beginPath(); ctx.moveTo(x+mc,y+mc); ctx.lineTo(x+mc+ts*1.5,y+mc); ctx.lineTo(x+mc,y+mc+ts*1.5); ctx.fill();
          ctx.beginPath(); ctx.moveTo(x+mc+ts*2,y+mc+ts*2); ctx.lineTo(x+mc+ts*2+ts2*1.5,y+mc+ts*2); ctx.lineTo(x+mc+ts*2,y+mc+ts*2+ts2*1.5); ctx.fill();
          ctx.beginPath(); ctx.moveTo(x+CARD-mc,y+CARD-mc); ctx.lineTo(x+CARD-mc-ts*1.5,y+CARD-mc); ctx.lineTo(x+CARD-mc,y+CARD-mc-ts*1.5); ctx.fill();
          ctx.beginPath(); ctx.moveTo(x+CARD-mc-ts*2,y+CARD-mc-ts*2); ctx.lineTo(x+CARD-mc-ts*2-ts2*1.5,y+CARD-mc-ts*2); ctx.lineTo(x+CARD-mc-ts*2,y+CARD-mc-ts*2-ts2*1.5); ctx.fill();
          break;
      }
      return;
    }

    if (card.type === 'clown') {
      this.drawFoilOverlay(x, y);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const clm = ctx.measureText('🤡');
      ctx.fillText('🤡', 0, (clm.actualBoundingBoxAscent - clm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.moveTo(cx, y + m); ctx.lineTo(cx - ts, y + m + ts * 1.5); ctx.lineTo(cx + ts, y + m + ts * 1.5); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx, y + CARD - m); ctx.lineTo(cx - ts, y + CARD - m - ts * 1.5); ctx.lineTo(cx + ts, y + CARD - m - ts * 1.5); ctx.fill();
      return;
    }

    if (card.type === 'clown-car') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const ccm = ctx.measureText('🚗');
      ctx.fillText('🚗', 0, (ccm.actualBoundingBoxAscent - ccm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      return;
    }

    if (card.type === 'balloon') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const blm = ctx.measureText('🎈');
      ctx.fillText('🎈', 0, (blm.actualBoundingBoxAscent - blm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.moveTo(cx, y + CARD - m); ctx.lineTo(cx - ts, y + CARD - m - ts * 1.5); ctx.lineTo(cx + ts, y + CARD - m - ts * 1.5); ctx.fill();
      return;
    }

    if (card.type === 'succubus') {
      this.drawFoilOverlay(x, y);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const scm = ctx.measureText('🦹‍♀️');
      ctx.fillText('🦹‍♀️', 0, (scm.actualBoundingBoxAscent - scm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.moveTo(cx, y + m); ctx.lineTo(cx - ts, y + m + ts * 1.5); ctx.lineTo(cx + ts, y + m + ts * 1.5); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx, y + CARD - m); ctx.lineTo(cx - ts, y + CARD - m - ts * 1.5); ctx.lineTo(cx + ts, y + CARD - m - ts * 1.5); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + m, cy); ctx.lineTo(x + m + ts * 1.5, cy - ts); ctx.lineTo(x + m + ts * 1.5, cy + ts); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + CARD - m, cy); ctx.lineTo(x + CARD - m - ts * 1.5, cy - ts); ctx.lineTo(x + CARD - m - ts * 1.5, cy + ts); ctx.fill();
      return;
    }

    if (card.type === 'lipstick') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const lsm = ctx.measureText('💄');
      ctx.fillText('💄', 0, (lsm.actualBoundingBoxAscent - lsm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      return;
    }

    if (card.type === 'kisses') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const ksm = ctx.measureText('💋');
      ctx.fillText('💋', 0, (ksm.actualBoundingBoxAscent - ksm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      return;
    }

    if (card.type === 'spider') {
      this.drawFoilOverlay(x, y);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const spm = ctx.measureText('🕷️');
      ctx.fillText('🕷️', 0, (spm.actualBoundingBoxAscent - spm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      // All 8 direction indicators
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.moveTo(cx, y + m); ctx.lineTo(cx - ts, y + m + ts * 1.5); ctx.lineTo(cx + ts, y + m + ts * 1.5); ctx.fill(); // up
      ctx.beginPath(); ctx.moveTo(cx, y + CARD - m); ctx.lineTo(cx - ts, y + CARD - m - ts * 1.5); ctx.lineTo(cx + ts, y + CARD - m - ts * 1.5); ctx.fill(); // down
      ctx.beginPath(); ctx.moveTo(x + m, cy); ctx.lineTo(x + m + ts * 1.5, cy - ts); ctx.lineTo(x + m + ts * 1.5, cy + ts); ctx.fill(); // left
      ctx.beginPath(); ctx.moveTo(x + CARD - m, cy); ctx.lineTo(x + CARD - m - ts * 1.5, cy - ts); ctx.lineTo(x + CARD - m - ts * 1.5, cy + ts); ctx.fill(); // right
      const mc = 7;
      ctx.beginPath(); ctx.moveTo(x + mc, y + mc); ctx.lineTo(x + mc + ts * 1.5, y + mc); ctx.lineTo(x + mc, y + mc + ts * 1.5); ctx.fill(); // up-left
      ctx.beginPath(); ctx.moveTo(x + CARD - mc, y + mc); ctx.lineTo(x + CARD - mc - ts * 1.5, y + mc); ctx.lineTo(x + CARD - mc, y + mc + ts * 1.5); ctx.fill(); // up-right
      ctx.beginPath(); ctx.moveTo(x + mc, y + CARD - mc); ctx.lineTo(x + mc + ts * 1.5, y + CARD - mc); ctx.lineTo(x + mc, y + CARD - mc - ts * 1.5); ctx.fill(); // down-left
      ctx.beginPath(); ctx.moveTo(x + CARD - mc, y + CARD - mc); ctx.lineTo(x + CARD - mc - ts * 1.5, y + CARD - mc); ctx.lineTo(x + CARD - mc, y + CARD - mc - ts * 1.5); ctx.fill(); // down-right
      return;
    }

    if (card.type === 'web') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const wbm = ctx.measureText('🕸️');
      ctx.fillText('🕸️', 0, (wbm.actualBoundingBoxAscent - wbm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      return;
    }

    if (card.type === 'egg') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const egm = ctx.measureText('🥚');
      ctx.fillText('🥚', 0, (egm.actualBoundingBoxAscent - egm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      return;
    }

    if (card.type === 'oni') {
      this.drawFoilOverlay(x, y);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const om = ctx.measureText('👹');
      ctx.fillText('👹', 0, (om.actualBoundingBoxAscent - om.actualBoundingBoxDescent) / 2);
      ctx.restore();
      return;
    }

    if (card.type === 'fire') {
      const FIRE_ANGLE: Record<Direction, number> = {
        up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2,
        'up-right': Math.PI / 4, 'down-right': 3 * Math.PI / 4,
        'down-left': -3 * Math.PI / 4, 'up-left': -Math.PI / 4,
      };
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(FIRE_ANGLE[card.direction]);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const frm = ctx.measureText('🔥');
      ctx.fillText('🔥', 0, (frm.actualBoundingBoxAscent - frm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      ctx.fillStyle = fg;
      ctx.beginPath();
      switch (card.direction) {
        case 'up':         ctx.moveTo(cx, y + m); ctx.lineTo(cx - ts, y + m + ts * 1.5); ctx.lineTo(cx + ts, y + m + ts * 1.5); break;
        case 'down':       ctx.moveTo(cx, y + CARD - m); ctx.lineTo(cx - ts, y + CARD - m - ts * 1.5); ctx.lineTo(cx + ts, y + CARD - m - ts * 1.5); break;
        case 'left':       ctx.moveTo(x + m, cy); ctx.lineTo(x + m + ts * 1.5, cy - ts); ctx.lineTo(x + m + ts * 1.5, cy + ts); break;
        case 'right':      ctx.moveTo(x + CARD - m, cy); ctx.lineTo(x + CARD - m - ts * 1.5, cy - ts); ctx.lineTo(x + CARD - m - ts * 1.5, cy + ts); break;
        case 'up-left':    ctx.moveTo(x + m, y + m); ctx.lineTo(x + m + ts * 1.5, y + m); ctx.lineTo(x + m, y + m + ts * 1.5); break;
        case 'up-right':   ctx.moveTo(x + CARD - m, y + m); ctx.lineTo(x + CARD - m - ts * 1.5, y + m); ctx.lineTo(x + CARD - m, y + m + ts * 1.5); break;
        case 'down-left':  ctx.moveTo(x + m, y + CARD - m); ctx.lineTo(x + m + ts * 1.5, y + CARD - m); ctx.lineTo(x + m, y + CARD - m - ts * 1.5); break;
        case 'down-right': ctx.moveTo(x + CARD - m, y + CARD - m); ctx.lineTo(x + CARD - m - ts * 1.5, y + CARD - m); ctx.lineTo(x + CARD - m, y + CARD - m - ts * 1.5); break;
      }
      ctx.fill();
      return;
    }

    if (card.type === 'fog') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const fm = ctx.measureText('🌫️');
      ctx.fillText('🌫️', 0, (fm.actualBoundingBoxAscent - fm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      return;
    }

    if (card.type === 'ghost') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const gm = ctx.measureText('👻');
      ctx.fillText('👻', 0, (gm.actualBoundingBoxAscent - gm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      return;
    }

    if (card.type === 'crystal-ball') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const cbm = ctx.measureText('🔮');
      ctx.fillText('🔮', 0, (cbm.actualBoundingBoxAscent - cbm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      return;
    }

    if (card.type === 'robot') {
      this.drawFoilOverlay(x, y);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const rm = ctx.measureText('🤖');
      ctx.fillText('🤖', 0, (rm.actualBoundingBoxAscent - rm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      return;
    }

    if (card.type === 'lightning') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const lm = ctx.measureText('⚡');
      ctx.fillText('⚡', 0, (lm.actualBoundingBoxAscent - lm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      return;
    }

    if (card.type === 'outlet') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const om = ctx.measureText('🔌');
      ctx.fillText('🔌', 0, (om.actualBoundingBoxAscent - om.actualBoundingBoxDescent) / 2);
      ctx.restore();
      // Up and down indicators only
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.moveTo(cx, y + m); ctx.lineTo(cx - ts, y + m + ts * 1.5); ctx.lineTo(cx + ts, y + m + ts * 1.5); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx, y + CARD - m); ctx.lineTo(cx - ts, y + CARD - m - ts * 1.5); ctx.lineTo(cx + ts, y + CARD - m - ts * 1.5); ctx.fill();
      return;
    }

    if (card.type === 'candle') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const cdm = ctx.measureText('🕯️');
      ctx.fillText('🕯️', 0, (cdm.actualBoundingBoxAscent - cdm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      return;
    }

    // Knife card
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(KNIFE_ANGLES[card.direction]);
    ctx.font = '28px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔪', 0, 0);
    ctx.restore();

    ctx.fillStyle = fg;
    ctx.beginPath();
    const mc = m;
    switch (card.direction) {
      case 'up':
        ctx.moveTo(cx, y + mc); ctx.lineTo(cx - ts, y + mc + ts * 1.5); ctx.lineTo(cx + ts, y + mc + ts * 1.5); break;
      case 'down':
        ctx.moveTo(cx, y + CARD - mc); ctx.lineTo(cx - ts, y + CARD - mc - ts * 1.5); ctx.lineTo(cx + ts, y + CARD - mc - ts * 1.5); break;
      case 'left':
        ctx.moveTo(x + mc, cy); ctx.lineTo(x + mc + ts * 1.5, cy - ts); ctx.lineTo(x + mc + ts * 1.5, cy + ts); break;
      case 'right':
        ctx.moveTo(x + CARD - mc, cy); ctx.lineTo(x + CARD - mc - ts * 1.5, cy - ts); ctx.lineTo(x + CARD - mc - ts * 1.5, cy + ts); break;
      case 'up-left':
        ctx.moveTo(x + mc, y + mc); ctx.lineTo(x + mc + ts * 1.5, y + mc); ctx.lineTo(x + mc, y + mc + ts * 1.5); break;
      case 'up-right':
        ctx.moveTo(x + CARD - mc, y + mc); ctx.lineTo(x + CARD - mc - ts * 1.5, y + mc); ctx.lineTo(x + CARD - mc, y + mc + ts * 1.5); break;
      case 'down-left':
        ctx.moveTo(x + mc, y + CARD - mc); ctx.lineTo(x + mc + ts * 1.5, y + CARD - mc); ctx.lineTo(x + mc, y + CARD - mc - ts * 1.5); break;
      case 'down-right':
        ctx.moveTo(x + CARD - mc, y + CARD - mc); ctx.lineTo(x + CARD - mc - ts * 1.5, y + CARD - mc); ctx.lineTo(x + CARD - mc, y + CARD - mc - ts * 1.5); break;
    }
    ctx.fill();
  }

  private drawSpin(now: number) {
    const { ctx, W, H, state, spinAnim } = this;
    if (!spinAnim || !state) return;

    const elapsed = now - spinAnim.startTime;
    const t = Math.min(elapsed / SPIN_DURATION, 1);
    const spinning = t < 1;

    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, W, H);

    // 🔪 KNIFE_ANGLES.up (-3π/4) rotates tip to face north (toward opponent at top).
    // KNIFE_ANGLES.down (π/4) rotates tip to face south (toward "you" at bottom).
    // going-first player is at bottom, so their target = KNIFE_ANGLES.down.
    const isMyTurn = spinAnim.firstPlayer === this.localNr;
    const target   = isMyTurn ? KNIFE_ANGLES.down : KNIFE_ANGLES.up;
    const wrongDir = isMyTurn ? KNIFE_ANGLES.up   : KNIFE_ANGLES.down;

    // Two-phase animation — avoids false "landed on wrong person" appearance:
    // Phase 1 (0–75%): constant-speed spin, 4.5 rotations, starts at target, ends at wrongDir
    // Phase 2 (75–100%): easeOutCubic, clean half-rotation from wrongDir → target
    // Velocities match at the boundary so there's no jerk.
    const PHASE1 = 0.75;
    let angle: number;
    if (spinning) {
      if (t < PHASE1) {
        angle = target + 4.5 * 2 * Math.PI * (t / PHASE1);
      } else {
        const phaseT = (t - PHASE1) / (1 - PHASE1);
        const eased = 1 - Math.pow(1 - phaseT, 3);
        angle = wrongDir + Math.PI * eased;
      }
    } else {
      angle = target;
    }

    // Labels — dim the side that didn't win
    const oppBright = !spinning && !isMyTurn;
    const meBright  = !spinning && isMyTurn;
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';

    ctx.fillStyle = oppBright ? '#eee' : spinning ? '#555' : '#333';
    ctx.fillText(!spinning && !isMyTurn ? 'opponent goes first' : 'opponent', W / 2, 52);

    ctx.fillStyle = meBright ? '#eee' : spinning ? '#555' : '#333';
    ctx.fillText(!spinning && isMyTurn ? 'you go first' : 'you', W / 2, H - 52);

    // Big knife
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(angle);
    ctx.font = '160px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔪', 0, 0);
    ctx.restore();

    // After settling: countdown to board
    if (!spinning) {
      const holdElapsed = elapsed - SPIN_DURATION;
      if (holdElapsed >= SPIN_HOLD) spinAnim.done = true;
    }
  }

  private draw() {
    const now = performance.now();

    if (this.spinAnim) {
      if (!this.spinAnim.done) { this.drawSpin(now); return; }
      this.spinAnim = null;
    }

    const { ctx, W, H, state } = this;

    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, W, H);

    if (!state) {
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(now * Math.PI / 600);
      ctx.font = '160px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🔪', 0, 0);
      ctx.restore();
      ctx.font = 'bold 14px monospace';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText('waiting for opponent', W / 2, 52);
      return;
    }

    const myIsBlack = this.localNr === state.blackPlayer;

    // grid
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const { x, y } = this.cellPos(row, col);
        ctx.beginPath();
        ctx.roundRect(x, y, CELL, CELL, 4);
        ctx.fillStyle = '#1e1030';
        ctx.fill();
        ctx.strokeStyle = '#3d2070';
        ctx.lineWidth = 1;
        ctx.stroke();

        const cell = state.board[row][col];
        if (cell && 'card' in cell) {
          const pad = (CELL - CARD) / 2;
          const flip = this.flipAnims.find(f => f.row === row && f.col === col);
          if (flip) {
            const FLIP_DUR = 340;
            const t = Math.min((now - flip.startTime) / FLIP_DUR, 1);
            const scaleX = Math.abs(Math.cos(Math.PI * t));
            ctx.save();
            ctx.translate(x + pad + CARD / 2, y + pad + CARD / 2);
            ctx.scale(scaleX, 1);
            if (t < 0.5) {
              this.drawCard(-CARD / 2, -CARD / 2, flip.oldCard, flip.oldIsBlack);
            } else {
              this.drawCard(-CARD / 2, -CARD / 2, flip.newCard, flip.newIsBlack);
            }
            ctx.restore();
            if (t >= 1) this.flipAnims = this.flipAnims.filter(f => f !== flip);
          } else {
            const fogged = this.isFoggedFor(row, col) && !this.isNearFire(row, col);
            this.drawCard(x + pad, y + pad, cell.card, cell.owner === state.blackPlayer, fogged);
            if (cell.zombified) this.drawZombifiedOverlay(x + pad, y + pad);
          }
        } else if (cell && 'blood' in cell) {
          ctx.font = '36px serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('🩸', x + CELL / 2, y + CELL / 2);
        }
      }
    }

    // drop highlights while dragging
    if (this.drag) {
      const isBandage = this.drag.card.type === 'bandage';
      const isWeb = this.drag.card.type === 'web';
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 4; col++) {
          const cell = state.board[row][col];
          const validDrop = !cell || (isBandage && cell && 'blood' in cell) || (isWeb && cell && !('blood' in cell));
          if (validDrop) {
            const { x, y } = this.cellPos(row, col);
            ctx.beginPath();
            ctx.roundRect(x, y, CELL, CELL, 4);
            ctx.strokeStyle = 'rgba(255,255,255,0.4)';
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }
      }
    }

    // Oni hand placement preview — show where the two hands will land
    if (this.drag?.card.type === 'oni' && this.hoverPos) {
      const hoverCell = this.hitCell(this.hoverPos.x, this.hoverPos.y);
      if (hoverCell && !state.board[hoverCell.row][hoverCell.col]) {
        for (const { row: hr, col: hc, emoji, angle, dir } of this.oniHandCells(hoverCell.row, hoverCell.col)) {
          const { x, y } = this.cellPos(hr, hc);
          ctx.beginPath();
          ctx.roundRect(x, y, CELL, CELL, 4);
          ctx.fillStyle = 'rgba(255, 160, 40, 0.12)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 160, 40, 0.7)';
          ctx.lineWidth = 2;
          ctx.stroke();
          // Emoji (rotated to match placed card orientation)
          ctx.save();
          ctx.translate(x + CELL / 2, y + CELL / 2);
          ctx.rotate(angle);
          ctx.font = '22px serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(emoji, 0, 0);
          ctx.restore();
          // Direction triangle (card-coordinate space: pad=2 offset into 68×68)
          const pad = (CELL - CARD) / 2;
          const xc = x + pad, yc = y + pad;
          const ccx = xc + CARD / 2, ccy = yc + CARD / 2;
          const m = 6, ts = 4;
          ctx.fillStyle = 'rgba(255, 200, 80, 0.9)';
          ctx.beginPath();
          switch (dir) {
            case 'up':         ctx.moveTo(ccx, yc + m); ctx.lineTo(ccx - ts, yc + m + ts * 1.5); ctx.lineTo(ccx + ts, yc + m + ts * 1.5); break;
            case 'down':       ctx.moveTo(ccx, yc + CARD - m); ctx.lineTo(ccx - ts, yc + CARD - m - ts * 1.5); ctx.lineTo(ccx + ts, yc + CARD - m - ts * 1.5); break;
            case 'left':       ctx.moveTo(xc + m, ccy); ctx.lineTo(xc + m + ts * 1.5, ccy - ts); ctx.lineTo(xc + m + ts * 1.5, ccy + ts); break;
            case 'right':      ctx.moveTo(xc + CARD - m, ccy); ctx.lineTo(xc + CARD - m - ts * 1.5, ccy - ts); ctx.lineTo(xc + CARD - m - ts * 1.5, ccy + ts); break;
            case 'up-right':   ctx.moveTo(xc + CARD - m, yc + m); ctx.lineTo(xc + CARD - m - ts * 1.5, yc + m); ctx.lineTo(xc + CARD - m, yc + m + ts * 1.5); break;
            case 'up-left':    ctx.moveTo(xc + m, yc + m); ctx.lineTo(xc + m + ts * 1.5, yc + m); ctx.lineTo(xc + m, yc + m + ts * 1.5); break;
            case 'down-left':  ctx.moveTo(xc + m, yc + CARD - m); ctx.lineTo(xc + m + ts * 1.5, yc + CARD - m); ctx.lineTo(xc + m, yc + CARD - m - ts * 1.5); break;
            case 'down-right': ctx.moveTo(xc + CARD - m, yc + CARD - m); ctx.lineTo(xc + CARD - m - ts * 1.5, yc + CARD - m); ctx.lineTo(xc + CARD - m, yc + CARD - m - ts * 1.5); break;
          }
          ctx.fill();
        }
      }
    }

    // opponent hand — face-down unless local player has an eye on the board
    const oppNr = Object.keys(state.hands).map(Number).find(n => n !== this.localNr);
    const oppHand = oppNr !== undefined ? (state.hands[oppNr] ?? []) : [];
    const oppIsBlack = oppNr === state.blackPlayer;
    const myEyeActive = state.board.flat().some(
      c => c && 'card' in c && c.owner === this.localNr && c.card.type === 'eye'
    );
    const oppLayout = this.computeHandLayout(oppHand, false);
    const HOVER_LIFT = 14;
    let oppHoveredEntry: CardLayout | null = null;
    for (let i = 0; i < oppLayout.length; i++) {
      const l = oppLayout[i];
      if (this.ghostSwapAnim?.hiddenIds.has(l.card.id)) continue;
      if (i === this.oppHoverIdx) { oppHoveredEntry = l; continue; }
      ctx.save();
      ctx.translate(l.cx, l.cy);
      ctx.rotate(l.rotation);
      this.drawCard(-CARD / 2, -CARD / 2, l.card, oppIsBlack, !myEyeActive);
      ctx.restore();
    }
    if (oppHoveredEntry) {
      const dx = oppHoveredEntry.cx - this.W / 2;
      const dy = oppHoveredEntry.cy - OPP_PIVOT_Y;
      const len = Math.sqrt(dx * dx + dy * dy);
      ctx.save();
      ctx.translate(oppHoveredEntry.cx + dx / len * HOVER_LIFT, oppHoveredEntry.cy + dy / len * HOVER_LIFT);
      ctx.rotate(oppHoveredEntry.rotation);
      this.drawCard(-CARD / 2, -CARD / 2, oppHoveredEntry.card, oppIsBlack, !myEyeActive);
      ctx.restore();
    }

    // my hand — face-up fan at bottom; hovered card drawn last so it layers on top
    const myHand = state.hands[this.localNr] ?? [];
    const myLayout = this.computeHandLayout(myHand, true);
    const draggingId = this.drag?.card.id;
    const hoveredId = this.hoveredHandCardId();
    let hoveredEntry: CardLayout | null = null;
    for (const l of myLayout) {
      if (l.card.id === draggingId) continue;
      if (this.ghostSwapAnim?.hiddenIds.has(l.card.id)) continue;
      if (this.cbReturnAnim?.hiddenId === l.card.id) continue;
      if (l.card.id === hoveredId) { hoveredEntry = l; continue; }
      ctx.save();
      ctx.translate(l.cx, l.cy);
      ctx.rotate(l.rotation);
      this.drawCard(-CARD / 2, -CARD / 2, l.card, myIsBlack);
      ctx.restore();
    }
    if (hoveredEntry) {
      const dx = hoveredEntry.cx - this.W / 2;
      const dy = hoveredEntry.cy - MY_PIVOT_Y;
      const len = Math.sqrt(dx * dx + dy * dy);
      ctx.save();
      ctx.translate(hoveredEntry.cx + dx / len * HOVER_LIFT, hoveredEntry.cy + dy / len * HOVER_LIFT);
      ctx.rotate(hoveredEntry.rotation);
      this.drawCard(-CARD / 2, -CARD / 2, hoveredEntry.card, myIsBlack);
      ctx.restore();
    }

    // scores — big numbers flanking the grid, colored by player
    const cells = state.board.flat();
    const scoreOf = (nr: number) => cells.filter(c => c && 'card' in c && c.owner === nr && !c.zombified).length;

    // left = local player, right = opponent
    const scoreMy  = scoreOf(this.localNr);
    const scoreOpp = oppNr !== undefined ? scoreOf(oppNr) : 0;

    const scoreCy = this.gridY + GRID / 2;
    const leftX   = this.gridX / 2;
    const rightX  = this.gridX + GRID + this.gridX / 2;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = '64px Trattatello, Luminari, fantasy';
    ctx.fillStyle = '#cc1111';
    const SCORE_BOUNCE_MS = 220;
    const scoreScale = (animStart: number | null) => {
      if (animStart === null) return 1;
      const t = Math.min((now - animStart) / SCORE_BOUNCE_MS, 1);
      if (t >= 1) return 1;
      return 1 + 0.28 * Math.sin(t * Math.PI); // arc: 1 → 1.28 → 1
    };
    for (const [cx, score, s] of [[leftX, scoreMy, scoreScale(this.scoreAnimMy)], [rightX, scoreOpp, scoreScale(this.scoreAnimOpp)]] as [number, number, number][]) {
      ctx.save();
      ctx.translate(cx, scoreCy - 10);
      ctx.scale(s, s);
      ctx.fillText(String(score), 0, 0);
      ctx.restore();
    }

    ctx.font = '14px monospace';
    ctx.fillStyle = '#aaa';
    ctx.fillText((myIsBlack ? '⬛ ' : '⬜ ') + 'you', leftX, scoreCy + 46);
    ctx.fillText((myIsBlack ? '⬜ ' : '⬛ ') + 'opp', rightX, scoreCy + 46);

    // match win circles — 2 per side, filled = won, empty = not yet
    {
      const myWins  = this.matchScore[this.localNr] ?? 0;
      const oppWins = oppNr !== undefined ? (this.matchScore[oppNr] ?? 0) : 0;
      const circleR   = 6;
      const circleGap = 6;
      const circleY   = scoreCy + 74;
      const totalW    = 2 * circleR * 2 + circleGap;
      for (const [cx, wins] of [[leftX, myWins], [rightX, oppWins]] as [number, number][]) {
        const startX = cx - totalW / 2 + circleR;
        for (let i = 0; i < 2; i++) {
          ctx.beginPath();
          ctx.arc(startX + i * (circleR * 2 + circleGap), circleY, circleR, 0, Math.PI * 2);
          if (i < wins) {
            ctx.fillStyle = '#cc1111';
            ctx.fill();
          } else {
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }
      }
    }

    // turn / result
    ctx.textBaseline = 'alphabetic';
    if (state.phase === 'finished') {
      const msg = state.winner === null ? 'draw!'
        : state.winner === this.localNr ? 'you win!' : 'you lose.';
      ctx.font = 'bold 14px monospace';
      ctx.fillStyle = '#fff';
      ctx.fillText(msg, W / 2, this.gridY + GRID + 30);
    } else {
      const isMyTurn = state.currentTurn === this.localNr;
      ctx.font = '14px monospace';
      ctx.fillStyle = isMyTurn ? '#eee' : '#444';
      // Equidistant between board bottom and top edge of highest hovered hand card
      const handTop = MY_HAND_CY - HOVER_LIFT - CARD / 2;
      ctx.fillText(isMyTurn ? 'your turn' : "opponent's turn", W / 2, (this.gridY + GRID + handTop) / 2);
    }

    // hellfire animation — green fire over destroyed cards, then fade
    if (this.hellfireAnim) this.drawHellfireAnim(now);

    // lightning flash — yellow rect over destroyed cells, fades out
    this.drawLightningFlash(now);

    // ghost swap animation — flying cards drawn above everything except drag
    if (this.ghostSwapAnim) {
      this.drawGhostSwapCards(now);
      if (this.ghostSwapAnim?.done) this.ghostSwapAnim = null;
    }

    // crystal ball return animation — card slides from board to hand
    if (this.cbReturnAnim) {
      this.drawCbReturnAnim(now);
      if (this.cbReturnAnim?.done) this.cbReturnAnim = null;
    }

    // drag ghost — always upright
    if (this.drag) {
      ctx.globalAlpha = 0.88;
      this.drawCard(this.drag.x - CARD / 2, this.drag.y - CARD / 2, this.drag.card, myIsBlack);
      ctx.globalAlpha = 1;
    }

    // hover tooltip
    if (this.hoverPos && !this.drag) {
      const hovered = this.findHoveredCard(this.hoverPos.x, this.hoverPos.y);
      if (hovered) {
        const label = CARD_LABELS[hovered.type];
        const pad = 8;
        ctx.font = '14px monospace';
        const tw = ctx.measureText(label).width;
        const bw = tw + pad * 2;
        const bh = 24;
        const bx = Math.max(4, Math.min(W - bw - 4, this.hoverPos.x - bw / 2));
        const by = Math.max(4, this.hoverPos.y - bh - 10);
        ctx.save();
        ctx.globalAlpha = 0.88;
        ctx.fillStyle = '#0a0a14';
        ctx.beginPath();
        ctx.roundRect(bx, by, bw, bh, 4);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#ccc';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, bx + pad, by + bh / 2);
        ctx.restore();
      }
    }

  }
}
