import type { GameState, Card, CardType, Direction } from './types';
import { type CustomFoilParams, drawCustomFoil, loadCustomFoilParams } from '../foil/customFoil';

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

const IDLE_SPEED       = Math.PI / 600;  // rad/ms — one rotation per ~1.2 s
const LANDING_DURATION = 3200;           // ms for landing spin
const SPIN_HOLD        = 1100;           // ms to hold settled result before showing board

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
  fire:    'wildfire: chain transforms in capture direction',
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
  bat:      'spawns a copy in a touching square; becomes blood when captured',
  dolphin:  'leaps: skips nearest card to capture the one behind',
  wave:     'sweeps entire row or column',
  anchor:   'immune to capture',
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
  private spinAnim: (
    | { mode: 'idle';    startTime: number }
    | { mode: 'landing'; startTime: number; startAngle: number; totalAngle: number; target: number; done: boolean }
  ) | null = null;
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
  private succubusPullAnims: { card: Card; fromX: number; fromY: number; toX: number; toY: number; toRow: number; toCol: number; startTime: number; pullIsBlack: boolean; landIsBlack: boolean; hiddenCardId: string }[] = [];
  private popAnims: { row: number; col: number; startTime: number }[] = [];
  private mermaidPullAnim: { card: Card; fromX: number; fromY: number; fromRot: number; toX: number; toY: number; toRow: number; toCol: number; startTime: number; pullIsBlack: boolean; landIsBlack: boolean; hiddenCardId: string } | null = null;
  private knifeShakeAnims: { row: number; col: number; startTime: number }[] = [];
  private vampireAnim: { vampX: number; vampY: number; cells: { row: number; col: number; fromX: number; fromY: number }[]; startTime: number; hiddenKeys: Set<string> } | null = null;

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

  startIdleSpin() {
    this.spinAnim = { mode: 'idle', startTime: performance.now() };
  }

  setState(state: GameState | null) {
    if (state && this.spinAnim?.mode === 'idle') {
      const now = performance.now();
      const idleAngle = (now - this.spinAnim.startTime) * IDLE_SPEED;
      const isMyTurn = state.currentTurn === this.localNr;
      const target = isMyTurn ? KNIFE_ANGLES.down : KNIFE_ANGLES.up;
      const normIdle   = ((idleAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const normTarget = ((target   % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const clockwiseDist = ((normTarget - normIdle) + 2 * Math.PI) % (2 * Math.PI);
      this.spinAnim = {
        mode: 'landing',
        startTime: now,
        startAngle: idleAngle,
        totalAngle: 3 * 2 * Math.PI + clockwiseDist,
        target,
        done: false,
      };
    }
    if (!state) { this.spinAnim = null; this.ghostSwapAnim = null; this.hellfireAnim = null; this.cbReturnAnim = null; this.lightningFlashAnims = []; this.scoreAnimMy = null; this.scoreAnimOpp = null; this.succubusPullAnims = []; this.popAnims = []; this.mermaidPullAnim = null; this.knifeShakeAnims = []; this.vampireAnim = null; }
    if (state && this.state) {
      this.detectGhostSwap(this.state, state);
      this.detectFlips(this.state, state);
      this.detectHellfire(this.state, state);
      this.detectCrystalBallReturn(this.state, state);
      this.detectLightningFlash(state);
      this.detectScoreChange(this.state, state);
      this.detectSuccubusPull(this.state, state);
      this.detectPops(this.state, state);
      this.detectMermaidPull(this.state, state);
      this.detectKnifeBlocks(state);
      this.detectVampireCapture(state);
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
    const MOON_STAGGER_MS = 70;
    const fireChain = newState.fireChain ?? [];
    const candleFirePos = newState.candleFirePos;
    const isCandlePlay = !!candleFirePos;
    const moonPos = newState.moonPos;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const old = oldState.board[r][c];
        const next = newState.board[r][c];
        if (old && 'card' in old && next && 'card' in next && old.owner !== next.owner) {
          this.flipAnims = this.flipAnims.filter(f => !(f.row === r && f.col === c));
          const isCandleCell = isCandlePlay && candleFirePos![0] === r && candleFirePos![1] === c;
          const chainIdx = fireChain.findIndex(([fr, fc]) => fr === r && fc === c);
          const moonDist = moonPos ? Math.abs(r - moonPos[0]) + Math.abs(c - moonPos[1]) : -1;
          const delay = isCandleCell
            ? FIRE_STAGGER_MS
            : chainIdx >= 0
              ? (isCandlePlay ? chainIdx + 2 : chainIdx) * FIRE_STAGGER_MS
              : moonDist > 0
                ? (moonDist - 1) * MOON_STAGGER_MS
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

  private detectSuccubusPull(oldState: GameState, newState: GameState) {
    const pulls = newState.succubusPulls;
    if (!pulls || pulls.length === 0) return;
    const now = performance.now();
    const pad = (CELL - CARD) / 2;
    for (const { fromRow, fromCol, toRow, toCol, card } of pulls) {
      const from = this.cellPos(fromRow, fromCol);
      const to   = this.cellPos(toRow, toCol);
      const oldCell = oldState.board[fromRow][fromCol];
      const pullIsBlack = oldCell && 'card' in oldCell ? oldCell.owner === oldState.blackPlayer : false;
      const landCell = newState.board[toRow][toCol];
      const landIsBlack = landCell && 'card' in landCell ? landCell.owner === newState.blackPlayer : false;
      this.succubusPullAnims.push({
        card,
        fromX: from.x + pad, fromY: from.y + pad,
        toX:   to.x   + pad, toY:   to.y   + pad,
        toRow, toCol,
        startTime: now,
        pullIsBlack,
        landIsBlack,
        hiddenCardId: card.id,
      });
    }
  }

  private drawSuccubusPullAnims(now: number) {
    if (this.succubusPullAnims.length === 0) return;
    const DURATION = 280;
    const ongoing: typeof this.succubusPullAnims = [];
    for (const anim of this.succubusPullAnims) {
      const t = Math.min((now - anim.startTime) / DURATION, 1);
      if (t >= 1) {
        this.flipAnims = this.flipAnims.filter(f => !(f.row === anim.toRow && f.col === anim.toCol));
        this.flipAnims.push({ row: anim.toRow, col: anim.toCol, startTime: now, oldCard: anim.card, oldIsBlack: anim.pullIsBlack, newCard: anim.card, newIsBlack: anim.landIsBlack });
        continue;
      }
      const e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      const x = anim.fromX + (anim.toX - anim.fromX) * e;
      const y = anim.fromY + (anim.toY - anim.fromY) * e;
      this.drawCard(x, y, anim.card, anim.pullIsBlack);
      ongoing.push(anim);
    }
    this.succubusPullAnims = ongoing;
  }

  private detectPops(oldState: GameState, newState: GameState) {
    const now = performance.now();
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const old = oldState.board[r][c];
        if (!old || !('card' in old)) continue;
        if (old.card.type !== 'balloon' && old.card.type !== 'bubbles') continue;
        const next = newState.board[r][c];
        const popped = !next || ('blood' in next) || ('card' in next && next.card.type !== old.card.type);
        if (popped) this.popAnims.push({ row: r, col: c, startTime: now });
      }
    }
  }

  private drawPopAnims(now: number) {
    if (this.popAnims.length === 0) return;
    const DURATION = 190;
    const ctx = this.ctx;
    this.popAnims = this.popAnims.filter(a => now - a.startTime < DURATION);
    for (const { row, col, startTime } of this.popAnims) {
      const t = Math.min((now - startTime) / DURATION, 1);
      const { x, y } = this.cellPos(row, col);
      const cx = x + CELL / 2, cy = y + CELL / 2;
      const radius = CELL * 0.35 + CELL * 0.65 * t;
      const alpha = Math.max(0, 1 - t);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, CELL, CELL);
      ctx.clip();
      ctx.globalAlpha = alpha * 0.7;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = '#aaddff';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }
  }

  private detectMermaidPull(oldState: GameState, newState: GameState) {
    const pull = newState.mermaidPull;
    if (!pull || this.localNr === 0) return;
    const playerNrs = Object.keys(newState.hands).map(Number);
    const oppNr = playerNrs.find(n => n !== this.localNr);
    if (oppNr === undefined) return;

    // Find the pulled card's position in the opponent's OLD hand fan
    const oldOppHand = oldState.hands[oppNr] ?? [];
    const cardIdx = oldOppHand.findIndex(c => c.id === pull.card.id);
    if (cardIdx === -1) return;
    const layout = this.computeHandLayout(oldOppHand, false);
    const { cx, cy, rotation } = layout[cardIdx];

    const pad = (CELL - CARD) / 2;
    const to = this.cellPos(pull.toRow, pull.toCol);
    const landCell = newState.board[pull.toRow][pull.toCol];
    const landIsBlack = landCell && 'card' in landCell ? landCell.owner === newState.blackPlayer : false;

    this.mermaidPullAnim = {
      card: pull.card,
      fromX: cx, fromY: cy, fromRot: rotation,
      toX: to.x + pad + CARD / 2, toY: to.y + pad + CARD / 2,
      toRow: pull.toRow, toCol: pull.toCol,
      startTime: performance.now(),
      pullIsBlack: oppNr === newState.blackPlayer, // opponent's color during flight
      landIsBlack,                                  // mermaid player's color after landing
      hiddenCardId: pull.card.id,
    };
  }

  private drawMermaidPullAnim(now: number) {
    if (!this.mermaidPullAnim) return;
    const DURATION = 380;
    const { card, fromX, fromY, fromRot, toX, toY, toRow, toCol, startTime, pullIsBlack, landIsBlack } = this.mermaidPullAnim;
    const t = Math.min((now - startTime) / DURATION, 1);
    if (t >= 1) {
      // land: synthesize a flip from opponent color → mermaid player color
      this.flipAnims = this.flipAnims.filter(f => !(f.row === toRow && f.col === toCol));
      this.flipAnims.push({ row: toRow, col: toCol, startTime: now, oldCard: card, oldIsBlack: pullIsBlack, newCard: card, newIsBlack: landIsBlack });
      this.mermaidPullAnim = null;
      return;
    }

    const e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // ease-in-out
    const x = fromX + (toX - fromX) * e;
    const y = fromY + (toY - fromY) * e;
    const rot = fromRot * (1 - e); // straighten as it arrives
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    this.drawCard(-CARD / 2, -CARD / 2, card, pullIsBlack);
    ctx.restore();
  }

  private detectVampireCapture(newState: GameState) {
    const vc = newState.vampireCaptures;
    if (!vc || vc.bloodCells.length === 0) return;
    const vampPos = this.cellPos(vc.vampRow, vc.vampCol);
    const vampX = vampPos.x + CELL / 2;
    const vampY = vampPos.y + CELL / 2;
    const cells = vc.bloodCells.map(([row, col]) => {
      const { x, y } = this.cellPos(row, col);
      return { row, col, fromX: x + CELL / 2, fromY: y + CELL / 2 };
    });
    const hiddenKeys = new Set(vc.bloodCells.map(([r, c]) => `${r},${c}`));
    this.vampireAnim = { vampX, vampY, cells, startTime: performance.now(), hiddenKeys };
  }

  private drawVampireAnim(now: number) {
    if (!this.vampireAnim) return;
    const DURATION = 380;
    const t = Math.min((now - this.vampireAnim.startTime) / DURATION, 1);
    if (t >= 1) { this.vampireAnim = null; return; }

    const e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // ease-in-out toward vampire
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '24px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 1 - t;
    for (const { fromX, fromY } of this.vampireAnim.cells) {
      const x = fromX + (this.vampireAnim.vampX - fromX) * e;
      const y = fromY + (this.vampireAnim.vampY - fromY) * e;
      ctx.fillText('🩸', x, y);
    }
    ctx.restore();
  }

  private detectKnifeBlocks(newState: GameState) {
    const blocks = newState.knifeBlocks;
    if (!blocks || blocks.length === 0) return;
    const now = performance.now();
    for (const [row, col] of blocks) {
      this.knifeShakeAnims = this.knifeShakeAnims.filter(a => !(a.row === row && a.col === col));
      this.knifeShakeAnims.push({ row, col, startTime: now });
    }
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
    this.succubusPullAnims = [];
    this.popAnims = [];
    this.mermaidPullAnim = null;
    this.knifeShakeAnims = [];
    this.vampireAnim = null;
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
    if (this.spinAnim && (this.spinAnim.mode === 'idle' || !this.spinAnim.done)) return;
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

  private foilStyle = Math.min(3, Math.max(0, parseInt(localStorage.getItem('foilStyle') ?? '2', 10)));
  private customFoilParams: CustomFoilParams = loadCustomFoilParams();

  setFoilStyle(n: number) {
    this.foilStyle = Math.min(3, Math.max(0, n));
    localStorage.setItem('foilStyle', String(this.foilStyle));
  }

  setCustomFoilParams(params: CustomFoilParams) {
    this.customFoilParams = params;
  }

  private drawFoilOverlay(x: number, y: number) {
    if (this.foilStyle === 3) {
      drawCustomFoil(this.ctx, x, y, this.customFoilParams, performance.now());
      return;
    }
    [this.drawFoilV1, this.drawFoilV2, this.drawFoilV3][this.foilStyle]?.call(this, x, y);
  }

  // V1 — original: single rotating rainbow gradient + sheen
  private drawFoilV1(x: number, y: number) {
    const ctx = this.ctx;
    const now = performance.now();
    const cx = x + CARD / 2;
    const cy = y + CARD / 2;
    const angle = (now / 3000) * Math.PI * 2;
    const r = CARD;
    const grad = ctx.createLinearGradient(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, cx - Math.cos(angle) * r, cy - Math.sin(angle) * r);
    grad.addColorStop(0,   'rgba(255,  20, 120, 0.30)');
    grad.addColorStop(0.2, 'rgba(255, 140,   0, 0.30)');
    grad.addColorStop(0.4, 'rgba(200, 255,   0, 0.30)');
    grad.addColorStop(0.6, 'rgba(  0, 255, 160, 0.30)');
    grad.addColorStop(0.8, 'rgba(  0, 140, 255, 0.30)');
    grad.addColorStop(1,   'rgba(180,   0, 255, 0.30)');
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
    ctx.fillStyle = grad; ctx.fillRect(x, y, CARD, CARD);
    ctx.fillStyle = sheen; ctx.fillRect(x, y, CARD, CARD);
    ctx.restore();
  }

  // V2 — dark blues/greens/purples with cross-hatch depth and sparkles
  private drawFoilV2(x: number, y: number) {
    const ctx = this.ctx;
    const now = performance.now();
    const cx = x + CARD / 2;
    const cy = y + CARD / 2;
    const r = CARD * 0.9;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, CARD, CARD, 6);
    ctx.clip();
    const a1 = (now / 4000) * Math.PI * 2;
    const g1 = ctx.createLinearGradient(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, cx - Math.cos(a1) * r, cy - Math.sin(a1) * r);
    g1.addColorStop(0,   'rgba(  0,  40, 180, 0.48)');
    g1.addColorStop(0.2, 'rgba(  0, 160,  80, 0.48)');
    g1.addColorStop(0.4, 'rgba( 80,   0, 200, 0.48)');
    g1.addColorStop(0.6, 'rgba(  0, 100, 220, 0.48)');
    g1.addColorStop(0.8, 'rgba(180, 160,   0, 0.48)');
    g1.addColorStop(1,   'rgba( 60,   0, 180, 0.48)');
    ctx.fillStyle = g1; ctx.fillRect(x, y, CARD, CARD);
    const a2 = a1 + Math.PI * 0.45;
    const g2 = ctx.createLinearGradient(cx + Math.cos(a2) * r, cy + Math.sin(a2) * r, cx - Math.cos(a2) * r, cy - Math.sin(a2) * r);
    g2.addColorStop(0,   'rgba(  0, 120, 160, 0.24)');
    g2.addColorStop(0.4, 'rgba( 40,   0, 180, 0.24)');
    g2.addColorStop(0.7, 'rgba(  0, 180,  80, 0.24)');
    g2.addColorStop(1,   'rgba(100,  80, 200, 0.24)');
    ctx.fillStyle = g2; ctx.fillRect(x, y, CARD, CARD);
    const SP: [number, number, number, number, number][] = [
      [0.15, 0.12, 0.0, 1.0, 0.3], [0.82, 0.08, 1.2, 1.5, 1.1],
      [0.67, 0.18, 0.7, 1.2, 0.0], [0.91, 0.31, 3.1, 1.4, 0.4],
      [0.12, 0.55, 0.3, 1.0, 1.3], [0.38, 0.62, 1.5, 0.8, 0.7],
      [0.58, 0.72, 0.9, 1.5, 1.0], [0.85, 0.65, 0.4, 0.9, 1.2],
      [0.08, 0.90, 3.0, 0.8, 0.8], [0.78, 0.55, 0.2, 1.5, 1.0],
    ];
    ctx.lineWidth = 0.8;
    for (const [fx, fy, phase, sf, rot] of SP) {
      const alpha = Math.pow(Math.max(0, Math.sin(now / 1800 + phase)), 2);
      if (alpha < 0.02) continue;
      const spx = x + fx * CARD; const spy = y + fy * CARD;
      const sz = (0.8 + sf * 1.4) * alpha;
      ctx.globalAlpha = alpha; ctx.strokeStyle = 'white';
      ctx.save(); ctx.translate(spx, spy); ctx.rotate(rot);
      ctx.beginPath(); ctx.moveTo(-sz, 0); ctx.lineTo(sz, 0); ctx.moveTo(0, -sz); ctx.lineTo(0, sz); ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    const sheenPos = ((now / 3500) % 1.6) - 0.3;
    const sx = x + sheenPos * CARD;
    const sheen = ctx.createLinearGradient(sx, y, sx + CARD * 0.4, y);
    sheen.addColorStop(0, 'rgba(255,255,255,0)'); sheen.addColorStop(0.5, 'rgba(255,255,255,0.28)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen; ctx.fillRect(x, y, CARD, CARD);
    ctx.restore();
  }

  // V3 — Rainbow Rare / VMax: glitter base → hard-light rainbow gradients → fine texture
  private drawFoilV3(x: number, y: number) {
    const ctx = this.ctx;
    const now = performance.now();
    const cx = x + CARD / 2;
    const cy = y + CARD / 2;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, CARD, CARD, 6);
    ctx.clip();

    // === Layer 1: Dense glitter base — bright dots, 1/3 twinkling ===
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'white';
    for (let i = 0; i < 60; i++) {
      const fx = (i * 0.618033) % 1;
      const fy = (i * 0.381966) % 1;
      const sz = 0.25 + (i % 4) * 0.18;
      const twinkle = i % 3 === 0
        ? Math.abs(Math.sin(now / 900 + i * 1.1))
        : 0.45 + (i % 7) * 0.08;
      ctx.globalAlpha = twinkle * 0.9;
      ctx.beginPath();
      ctx.arc(x + fx * CARD, y + fy * CARD, sz, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // === Layer 2: Fine diagonal cross-hatch texture ===
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 0.5;
    for (let d = -CARD; d < CARD * 2; d += 5) {
      ctx.beginPath(); ctx.moveTo(x + d, y); ctx.lineTo(x + d + CARD, y + CARD); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + d + CARD, y); ctx.lineTo(x + d, y + CARD); ctx.stroke();
    }

    // === Layer 3: Rainbow gradients with hard-light blend ===
    ctx.globalCompositeOperation = 'hard-light';

    const a = (now / 8000) * Math.PI * 2;
    const r = CARD;
    const g1 = ctx.createLinearGradient(cx + Math.cos(a) * r, cy + Math.sin(a) * r, cx - Math.cos(a) * r, cy - Math.sin(a) * r);
    g1.addColorStop(0,    'rgba(255, 100,  90, 0.82)');
    g1.addColorStop(0.17, 'rgba(255, 200,  60, 0.82)');
    g1.addColorStop(0.33, 'rgba(140, 255, 100, 0.82)');
    g1.addColorStop(0.50, 'rgba( 50, 210, 255, 0.82)');
    g1.addColorStop(0.67, 'rgba( 90, 100, 255, 0.82)');
    g1.addColorStop(0.83, 'rgba(210,  70, 255, 0.82)');
    g1.addColorStop(1,    'rgba(255, 100,  90, 0.82)');
    ctx.fillStyle = g1;
    ctx.fillRect(x, y, CARD, CARD);

    const a2 = a + Math.PI * 0.38;
    const g2 = ctx.createLinearGradient(cx + Math.cos(a2) * r, cy + Math.sin(a2) * r, cx - Math.cos(a2) * r, cy - Math.sin(a2) * r);
    g2.addColorStop(0,   'rgba(255, 255, 210, 0.50)');
    g2.addColorStop(0.4, 'rgba(210, 255, 230, 0.50)');
    g2.addColorStop(0.7, 'rgba(210, 210, 255, 0.50)');
    g2.addColorStop(1,   'rgba(255, 220, 255, 0.50)');
    ctx.fillStyle = g2;
    ctx.fillRect(x, y, CARD, CARD);

    ctx.globalCompositeOperation = 'source-over';

    // === Layer 4: Sheen sweep ===
    const sheenPos = ((now / 3500) % 1.6) - 0.3;
    const sx = x + sheenPos * CARD;
    const sheen = ctx.createLinearGradient(sx, y, sx + CARD * 0.35, y);
    sheen.addColorStop(0,   'rgba(255,255,255,0)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0.20)');
    sheen.addColorStop(1,   'rgba(255,255,255,0)');
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

    if (card.type === 'dolphin') {
      this.drawFoilOverlay(x, y);
      ctx.save();
      ctx.translate(cx, cy - 6);
      ctx.font = '24px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const dm = ctx.measureText('🐬');
      ctx.fillText('🐬', 0, (dm.actualBoundingBoxAscent - dm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      ctx.save();
      ctx.translate(cx, cy + 12);
      ctx.font = '16px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const moto = ctx.measureText('🏍️');
      ctx.fillText('🏍️', 0, (moto.actualBoundingBoxAscent - moto.actualBoundingBoxDescent) / 2);
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

    if (card.type === 'wave') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const wvm = ctx.measureText('🌊');
      ctx.fillText('🌊', 0, (wvm.actualBoundingBoxAscent - wvm.actualBoundingBoxDescent) / 2);
      ctx.restore();
      ctx.fillStyle = fg;
      const isHoriz = card.direction === 'left' || card.direction === 'right';
      if (isHoriz) {
        // Left arrow
        ctx.beginPath(); ctx.moveTo(x + m, cy); ctx.lineTo(x + m + ts * 1.5, cy - ts); ctx.lineTo(x + m + ts * 1.5, cy + ts); ctx.fill();
        // Right arrow
        ctx.beginPath(); ctx.moveTo(x + CARD - m, cy); ctx.lineTo(x + CARD - m - ts * 1.5, cy - ts); ctx.lineTo(x + CARD - m - ts * 1.5, cy + ts); ctx.fill();
      } else {
        // Up arrow
        ctx.beginPath(); ctx.moveTo(cx, y + m); ctx.lineTo(cx - ts, y + m + ts * 1.5); ctx.lineTo(cx + ts, y + m + ts * 1.5); ctx.fill();
        // Down arrow
        ctx.beginPath(); ctx.moveTo(cx, y + CARD - m); ctx.lineTo(cx - ts, y + CARD - m - ts * 1.5); ctx.lineTo(cx + ts, y + CARD - m - ts * 1.5); ctx.fill();
      }
      return;
    }

    if (card.type === 'anchor') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const am = ctx.measureText('⚓');
      ctx.fillText('⚓', 0, (am.actualBoundingBoxAscent - am.actualBoundingBoxDescent) / 2);
      ctx.restore();
      return;
    }

    if (card.type === 'bat') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const bm = ctx.measureText('🦇');
      ctx.fillText('🦇', 0, (bm.actualBoundingBoxAscent - bm.actualBoundingBoxDescent) / 2);
      ctx.restore();
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
    const { ctx, W, H } = this;
    const spinAnim = this.spinAnim;
    if (!spinAnim) return;

    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, W, H);

    let angle: number;

    if (spinAnim.mode === 'idle') {
      angle = (now - spinAnim.startTime) * IDLE_SPEED;
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#555';
      ctx.fillText('opponent', W / 2, 52);
      ctx.fillStyle = '#555';
      ctx.fillText('you', W / 2, H - 52);
    } else {
      const elapsed = now - spinAnim.startTime;
      const t = Math.min(elapsed / LANDING_DURATION, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const settled = t >= 1;

      // At settlement, derive both the angle and the label from the live
      // game state so they are definitionally correct regardless of any
      // timing edge case. During animation, use the baked target.
      const isMyTurn = settled && this.state
        ? this.state.currentTurn === this.localNr
        : spinAnim.target === KNIFE_ANGLES.down;
      const resolvedTarget = settled && this.state
        ? (this.state.currentTurn === this.localNr ? KNIFE_ANGLES.down : KNIFE_ANGLES.up)
        : spinAnim.target;
      angle = settled ? resolvedTarget : spinAnim.startAngle + spinAnim.totalAngle * eased;

      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = (settled && !isMyTurn) ? '#eee' : '#555';
      ctx.fillText((settled && !isMyTurn) ? 'opponent goes first' : 'opponent', W / 2, 52);
      ctx.fillStyle = (settled && isMyTurn) ? '#eee' : '#555';
      ctx.fillText((settled && isMyTurn) ? 'you go first' : 'you', W / 2, H - 52);

      if (settled && elapsed - LANDING_DURATION >= SPIN_HOLD) spinAnim.done = true;
    }

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(angle);
    ctx.font = '160px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔪', 0, 0);
    ctx.restore();
  }

  private draw() {
    const now = performance.now();

    if (this.spinAnim) {
      if (this.spinAnim.mode === 'idle' || !this.spinAnim.done) { this.drawSpin(now); return; }
      this.spinAnim = null;
    }

    const { ctx, W, H, state } = this;
    if (!state) return;

    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, W, H);

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
        if (cell && 'card' in cell && this.mermaidPullAnim?.hiddenCardId === cell.card.id) continue;
        if (cell && 'card' in cell && this.succubusPullAnims.some(a => a.hiddenCardId === cell.card.id)) continue;
        if (this.vampireAnim?.hiddenKeys.has(`${row},${col}`)) continue;
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
            const shake = (() => {
              const sa = this.knifeShakeAnims.find(a => a.row === row && a.col === col);
              if (!sa) return 0;
              const SHAKE_DUR = 450;
              const st = (now - sa.startTime) / SHAKE_DUR;
              if (st >= 1) { this.knifeShakeAnims = this.knifeShakeAnims.filter(a => a !== sa); return 0; }
              return Math.sin(st * Math.PI * 4) * 3 * (1 - st);
            })();
            this.drawCard(x + pad + shake, y + pad, cell.card, cell.owner === state.blackPlayer, fogged);
            if (cell.zombified) this.drawZombifiedOverlay(x + pad + shake, y + pad);
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

    // balloon/bubbles pop — expanding ring
    this.drawPopAnims(now);

    // succubus pull — ghost card sliding from old to new position
    this.drawSuccubusPullAnims(now);

    // mermaid pull — card flies from opponent hand fan to board cell
    this.drawMermaidPullAnim(now);

    // vampire drain — blood emojis fly toward vampire before squares become vampires
    this.drawVampireAnim(now);

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
