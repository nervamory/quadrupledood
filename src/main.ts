import { PhotonClient } from './network/PhotonClient';
import { Game } from './game/Game';
import { UI } from './ui/UI';
import { initGame, placeCard } from './game/gameLogic';
import type { GameState, DeckType } from './game/types';
import {
  type CustomFoilParams,
  drawCustomFoil,
  loadCustomFoilParams,
  saveCustomFoilParams,
} from './foil/customFoil';

function getElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Required element #${id} not found`);
  return el as T;
}

const ui = new UI();
const game = new Game(getElement<HTMLCanvasElement>('game-canvas'));

let gameState: GameState | null = null;
let oppDeck: DeckType | null = null;
let debugMode = false;
let inRoom = false;
let gameStarted = false;
let reconnectInterval: ReturnType<typeof setInterval> | null = null;

const RECONNECT_SECS = 60;

function doLeave(status?: string) {
  clearEndTimer();
  clearReconnectWait();
  oppDeck = null;
  oppReadyDeck = null;
  myReadyDeck = null;
  gameState = null;
  matchScore = {};
  inRoom = false;
  gameStarted = false;
  photon.leave();
  game.reset();
  ui.showLobby();
  if (status) ui.setStatus(status);
}

function startReconnectWait() {
  if (reconnectInterval !== null) return;
  let secs = RECONNECT_SECS;
  const overlay = document.getElementById('reconnect-overlay')!;
  const msg = document.getElementById('reconnect-msg')!;
  const update = () => { msg.textContent = `opponent disconnected\nwaiting ${secs}s for reconnect…`; };
  update();
  overlay.style.display = 'flex';
  reconnectInterval = setInterval(() => {
    secs--;
    if (secs <= 0) {
      doLeave('opponent did not reconnect');
    } else {
      update();
    }
  }, 1000);
}

function clearReconnectWait() {
  if (reconnectInterval) { clearInterval(reconnectInterval); reconnectInterval = null; }
  const overlay = document.getElementById('reconnect-overlay');
  if (overlay) overlay.style.display = 'none';
}

// Match state
let matchScore: Record<number, number> = {};
let myPlayedDeck: DeckType | null = null;   // deck I used in the last completed game
let myReadyDeck: DeckType | null = null;    // deck I signalled ready with
let oppReadyDeck: DeckType | null = null;   // deck opponent signalled ready with
let endTransitionTimer: ReturnType<typeof setTimeout> | null = null;

function getSelectedDeck(): DeckType {
  return getElement<HTMLSelectElement>('deck-select').value as DeckType;
}

// ── CPU opponent ───────────────────────────────────────────────────────────────

const CPU_LOCAL_NR = 1;
const CPU_OPP_NR   = 2;
const CPU_DECKS: DeckType[] = ['vampire','werewolf','ocean','bones','zombie','oni','spider','knife','demon','clown','succubus','ghost','robot','dolphin'];

let cpuMode = false;
let cpuMoveTimer: ReturnType<typeof setTimeout> | null = null;

const CPU_DIR_OFFSETS: Record<string, [number, number]> = {
  up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1],
  'up-left': [-1, -1], 'up-right': [-1, 1], 'down-left': [1, -1], 'down-right': [1, 1],
};

function getCpuMove(state: GameState): { cardId: string; row: number; col: number } | null {
  const hand = state.hands[CPU_OPP_NR] ?? [];
  if (hand.length === 0) return null;
  const board = state.board;

  const isOppCard = (r: number, c: number) => {
    if (r < 0 || r > 3 || c < 0 || c > 3) return false;
    const cell = board[r][c];
    return cell !== null && 'card' in cell && cell.owner !== CPU_OPP_NR;
  };

  const scoreCard = (card: typeof hand[0], row: number, col: number): number => {
    const t = card.type;
    if (t === 'spider' || t === 'moon') {
      let s = 0;
      for (const [dr, dc] of Object.values(CPU_DIR_OFFSETS)) if (isOppCard(row + dr, col + dc)) s++;
      return s;
    }
    if (t === 'troll' || t === 'heart') {
      let s = 0;
      for (const dir of ['up','down','left','right'] as const) {
        const [dr, dc] = CPU_DIR_OFFSETS[dir]; if (isOppCard(row + dr, col + dc)) s++;
      }
      return s;
    }
    const [dr, dc] = CPU_DIR_OFFSETS[card.direction];
    return isOppCard(row + dr, col + dc) ? 1 : 0;
  };

  const moves: { cardId: string; row: number; col: number; score: number }[] = [];
  for (const card of hand) {
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const cell = board[r][c];
        const valid = cell === null
          || ('blood' in cell && card.type === 'bandage')
          || ('card'  in cell && card.type === 'web');
        if (!valid) continue;
        moves.push({ cardId: card.id, row: r, col: c, score: scoreCard(card, r, c) });
      }
    }
  }
  if (moves.length === 0) return null;
  const best = Math.max(...moves.map(m => m.score));
  const top  = moves.filter(m => m.score === best);
  return top[Math.floor(Math.random() * top.length)];
}

function scheduleCpuMove() {
  if (cpuMoveTimer !== null) return;
  cpuMoveTimer = setTimeout(() => {
    cpuMoveTimer = null;
    if (!gameState || gameState.currentTurn !== CPU_OPP_NR || gameState.phase !== 'playing') return;
    const move = getCpuMove(gameState);
    if (!move) return;
    gameState = placeCard(gameState, CPU_OPP_NR, move.cardId, move.row, move.col);
    game.setState(gameState);
    if (gameState.phase === 'finished') handleCpuGameEnd(gameState);
  }, 600);
}

function startCpuGame(myDeck: DeckType) {
  if (cpuMoveTimer !== null) { clearTimeout(cpuMoveTimer); cpuMoveTimer = null; }
  const cpuDeck = CPU_DECKS[Math.floor(Math.random() * CPU_DECKS.length)];
  const firstPlayer = Math.random() < 0.5 ? CPU_LOCAL_NR : CPU_OPP_NR;
  const state = initGame(CPU_LOCAL_NR, CPU_OPP_NR, firstPlayer, myDeck, cpuDeck);
  gameState = state;
  myPlayedDeck = myDeck;
  game.setLocalActor(CPU_LOCAL_NR);
  game.setMatchScore(matchScore);
  game.startIdleSpin();
  game.setState(state);
  ui.showGame();
  if (state.currentTurn === CPU_OPP_NR) scheduleCpuMove();
}

function handleCpuGameEnd(state: GameState) {
  if (state.winner !== null) {
    matchScore[state.winner] = (matchScore[state.winner] ?? 0) + 1;
  }
  const myWins  = matchScore[CPU_LOCAL_NR] ?? 0;
  const oppWins = matchScore[CPU_OPP_NR]   ?? 0;
  clearEndTimer();
  endTransitionTimer = setTimeout(() => {
    endTransitionTimer = null;
    if (myWins >= 2 || oppWins >= 2) {
      ui.showMatchOver({ myWins, oppWins, iWon: myWins >= 2 });
      return;
    }
    const lastResult: 'win' | 'loss' | 'draw' =
      state.winner === null ? 'draw'
      : state.winner === CPU_LOCAL_NR ? 'win' : 'loss';
    const lockedDeck = state.winner === CPU_LOCAL_NR ? myPlayedDeck : null;
    ui.showBetweenGames({ myWins, oppWins, lastResult, lockedDeck });
  }, 2000);
}

function doCpuLeave() {
  if (cpuMoveTimer !== null) { clearTimeout(cpuMoveTimer); cpuMoveTimer = null; }
  clearEndTimer();
  cpuMode = false;
  gameState = null;
  matchScore = {};
  myPlayedDeck = null;
  myReadyDeck = null;
  oppReadyDeck = null;
  game.reset();
  ui.showLobby();
}

// ── match helpers ─────────────────────────────────────────────────────────────

function clearEndTimer() {
  if (endTransitionTimer !== null) { clearTimeout(endTransitionTimer); endTransitionTimer = null; }
}

function startGame(myDeck: DeckType, oppDeckUsed: DeckType) {
  if (photon.playerCount !== 2) return;
  const [a1, a2] = photon.allActorNrs;
  const oppNr = photon.allActorNrs.find(n => n !== photon.actorNr)!;
  const deckOf: Record<number, DeckType> = {
    [photon.actorNr]: myDeck,
    [oppNr]: oppDeckUsed,
  };
  const firstPlayer = Math.random() < 0.5 ? a1 : a2;
  const state = initGame(a1, a2, firstPlayer, deckOf[a1], deckOf[a2]);
  gameState = state;
  myPlayedDeck = myDeck;
  game.setMatchScore(matchScore);
  game.startIdleSpin();
  game.setState(state);
  photon.sendGameStart(state);
  ui.showGame();
}

function tryNextGame() {
  if (!photon.isMaster || myReadyDeck === null || oppReadyDeck === null) return;
  const my = myReadyDeck;
  const opp = oppReadyDeck;
  myReadyDeck = null;
  oppReadyDeck = null;
  startGame(my, opp);
}

function handleGameEnd(state: GameState) {
  // Update match score
  if (state.winner !== null) {
    matchScore[state.winner] = (matchScore[state.winner] ?? 0) + 1;
  }

  const myWins = matchScore[photon.actorNr] ?? 0;
  const oppNr = photon.allActorNrs.find(n => n !== photon.actorNr)!;
  const oppWins = matchScore[oppNr] ?? 0;

  clearEndTimer();
  endTransitionTimer = setTimeout(() => {
    endTransitionTimer = null;

    // Match over?
    if (myWins >= 2 || oppWins >= 2) {
      ui.showMatchOver({ myWins, oppWins, iWon: myWins >= 2 });
      return;
    }

    // Between games
    const lastResult: 'win' | 'loss' | 'draw' =
      state.winner === null ? 'draw'
      : state.winner === photon.actorNr ? 'win'
      : 'loss';

    // Winner must keep their deck; loser can pick freely
    const iWonLastGame = state.winner === photon.actorNr;
    const lockedDeck = iWonLastGame ? myPlayedDeck : null;

    ui.showBetweenGames({ myWins, oppWins, lastResult, lockedDeck });
  }, 2000);
}

// ── Photon ────────────────────────────────────────────────────────────────────

function tryStartGame() {
  if (gameStarted || !photon.isMaster || photon.playerCount !== 2 || oppDeck === null) return;
  gameStarted = true;
  const [a1, a2] = photon.allActorNrs;
  const myDeck = getSelectedDeck();
  const oppNr = photon.allActorNrs.find(n => n !== photon.actorNr)!;
  const deckOf: Record<number, DeckType> = {
    [photon.actorNr]: myDeck,
    [oppNr]: oppDeck,
  };
  const firstPlayer = Math.random() < 0.5 ? a1 : a2;
  const state = initGame(a1, a2, firstPlayer, deckOf[a1], deckOf[a2]);
  gameState = state;
  myPlayedDeck = myDeck;
  matchScore = {};
  game.setMatchScore(matchScore);
  game.setState(state);
  photon.sendGameStart(state);
  oppDeck = null;
}

const photon = new PhotonClient({
  onJoined: (actorNr) => {
    inRoom = true;
    game.setLocalActor(actorNr);
    clearReconnectWait();
    if (gameState === null) {
      game.startIdleSpin();
      ui.showGame();
    }
  },
  onPlayerJoined: (_actorNr) => {
    clearReconnectWait();
    photon.sendDeckPick(getSelectedDeck());
    photon.sendFoilPick(parseInt(foilSelect.value, 10), workingFoilParams);
    if (photon.isMaster && gameState !== null && gameState.phase === 'playing') {
      photon.sendGameStart(gameState);
    } else {
      tryStartGame();
    }
  },
  onPlayerLeft: (_actorNr) => {
    if (!inRoom) return;
    clearEndTimer();
    startReconnectWait();
  },
  onGameStart: (state) => {
    const isResync = gameState !== null;
    gameState = state;
    myPlayedDeck = myReadyDeck ?? getSelectedDeck();
    game.setMatchScore(matchScore);
    if (!isResync) {
      game.startIdleSpin();
    }
    game.setState(state);
    ui.showGame();
  },
  onCardPlaced: (actorNr, cardId, row, col) => {
    if (!gameState) return;
    gameState = placeCard(gameState, actorNr, cardId, row, col);
    game.setState(gameState);
    if (gameState.phase === 'finished') handleGameEnd(gameState);
  },
  onDeckPick: (_actorNr, deck) => {
    if (!photon.isMaster) return;
    oppDeck = deck;
    tryStartGame();
  },
  onReady: (actorNr, deck) => {
    const oppNr = photon.allActorNrs.find(n => n !== photon.actorNr);
    if (actorNr === oppNr) {
      ui.setBetweenStatus('opponent is ready');
    }
    if (photon.isMaster) {
      if (actorNr !== photon.actorNr) {
        oppReadyDeck = deck;
      }
      tryNextGame();
    }
  },
  onFoilPick: (style, params) => {
    game.setOppFoilStyle(style, params);
  },
  onRematch: () => {
    matchScore = {};
    myPlayedDeck = null;
    myReadyDeck = null;
    oppReadyDeck = null;
    ui.showBetweenGames({ myWins: 0, oppWins: 0, lastResult: 'draw', lockedDeck: null });
  },
  onLobbyUpdate: (count) => {
    ui.setStatus(`${count} ${count === 1 ? 'player' : 'players'} currently sacrificing`);
  },
  onStatusChange: (msg) => ui.setStatus(msg),
  onDisconnected: () => {
    if (gameState !== null && gameState.phase === 'playing') {
      const overlay = document.getElementById('reconnect-overlay')!;
      const msg = document.getElementById('reconnect-msg')!;
      msg.textContent = 'connection lost\nreconnecting…';
      overlay.style.display = 'flex';
    } else {
      doLeave();
    }
  },
  onOpponentHover: (idx) => {
    game.setOppHover(idx);
  },
});

// ── game callbacks ────────────────────────────────────────────────────────────

game.onHoverChange = (idx) => {
  photon.sendHover(idx);
};

game.onPlaceCard = (cardId, row, col) => {
  if (!gameState) return;
  if (cpuMode) {
    gameState = placeCard(gameState, CPU_LOCAL_NR, cardId, row, col);
    game.setState(gameState);
    if (gameState.phase === 'finished') handleCpuGameEnd(gameState);
    else if (gameState.currentTurn === CPU_OPP_NR) scheduleCpuMove();
  } else {
    gameState = placeCard(gameState, photon.actorNr, cardId, row, col);
    game.setState(gameState);
    photon.sendPlaceCard(cardId, row, col);
    if (gameState.phase === 'finished') handleGameEnd(gameState);
  }
};

// ── lobby button ──────────────────────────────────────────────────────────────

getElement('join-btn').addEventListener('click', () => {
  if (debugMode) {
    if (getElement<HTMLInputElement>('cpu-check').checked) {
      cpuMode = true;
      matchScore = {};
      startCpuGame(getSelectedDeck());
      return;
    }
    const roomName = getElement<HTMLInputElement>('room-name').value.trim();
    if (!roomName) return;
    photon.connectAndJoin(roomName);
  } else {
    photon.joinMatchmaking();
  }
});

getElement('leave-btn').addEventListener('click', () => { if (cpuMode) { doCpuLeave(); return; } doLeave(); });

// ── between-games buttons ─────────────────────────────────────────────────────

getElement('ready-btn').addEventListener('click', () => {
  if (cpuMode) {
    startCpuGame(ui.getBetweenDeck());
    return;
  }
  const deck = ui.getBetweenDeck();
  myReadyDeck = deck;
  photon.sendReady(deck);
  // Non-master: just wait. Master: store own ready and try to start.
  if (photon.isMaster) {
    tryNextGame();
  }
  ui.setBetweenStatus('waiting for opponent…');
  getElement<HTMLButtonElement>('ready-btn').disabled = true;
});

getElement('between-leave-btn').addEventListener('click', () => { if (cpuMode) { doCpuLeave(); return; } doLeave(); });

// ── match-over buttons ────────────────────────────────────────────────────────

getElement('rematch-btn').addEventListener('click', () => {
  matchScore = {};
  myPlayedDeck = null;
  myReadyDeck = null;
  oppReadyDeck = null;
  if (cpuMode) {
    ui.showBetweenGames({ myWins: 0, oppWins: 0, lastResult: 'draw', lockedDeck: null });
    return;
  }
  photon.sendRematch();
  ui.showBetweenGames({ myWins: 0, oppWins: 0, lastResult: 'draw', lockedDeck: null });
});

getElement('matchover-leave-btn').addEventListener('click', () => { if (cpuMode) { doCpuLeave(); return; } doLeave(); });

getElement('reconnect-leave-btn').addEventListener('click', () => { if (cpuMode) { doCpuLeave(); return; } doLeave(); });

// ── settings ──────────────────────────────────────────────────────────────────

const foilSelect = getElement<HTMLSelectElement>('foil-style-select');
foilSelect.value = String(Math.min(3, Math.max(0, parseInt(localStorage.getItem('foilStyle') ?? '2', 10))));
foilSelect.addEventListener('change', () => {
  const style = parseInt(foilSelect.value, 10);
  game.setFoilStyle(style);
  if (inRoom) photon.sendFoilPick(style, workingFoilParams);
});

const deckSelect    = getElement<HTMLSelectElement>('deck-select');
const prefDeckSelect = getElement<HTMLSelectElement>('pref-deck-select');
const savedDeck = localStorage.getItem('deckPref') ?? 'random';
deckSelect.value = savedDeck;
prefDeckSelect.value = savedDeck;
prefDeckSelect.addEventListener('change', () => {
  localStorage.setItem('deckPref', prefDeckSelect.value);
  deckSelect.value = prefDeckSelect.value;
});

const colorblindToggle = getElement<HTMLInputElement>('colorblind-toggle');
colorblindToggle.checked = localStorage.getItem('colorblindMode') === 'true';
game.setColorblindMode(colorblindToggle.checked);
colorblindToggle.addEventListener('change', () => {
  game.setColorblindMode(colorblindToggle.checked);
  localStorage.setItem('colorblindMode', String(colorblindToggle.checked));
});

getElement('settings-btn').addEventListener('click', () => ui.showSettings());
getElement('settings-back-btn').addEventListener('click', () => ui.showLobby());

// ── foil creator ──────────────────────────────────────────────────────────────

let workingFoilParams: CustomFoilParams = loadCustomFoilParams();
let previewRaf = 0;

const previewCanvas = getElement<HTMLCanvasElement>('foil-preview');
const previewCtx = previewCanvas.getContext('2d')!;

function syncSlidersToParams(p: CustomFoilParams) {
  (getElement<HTMLInputElement>('fc-glitter-count')).value      = String(p.glitterCount);
  (getElement<HTMLInputElement>('fc-glitter-period')).value     = String(p.glitterPeriodMs);
  (getElement<HTMLInputElement>('fc-glitter-alpha')).value      = String(p.glitterAlpha);
  (getElement<HTMLInputElement>('fc-glitter-fullcard')).checked = p.glitterFullCard;
  (getElement<HTMLInputElement>('fc-hatch-enabled')).checked = p.hatchEnabled;
  (getElement<HTMLInputElement>('fc-hatch-spacing')).value   = String(p.hatchSpacing);
  (getElement<HTMLInputElement>('fc-hatch-opacity')).value   = String(p.hatchOpacity);
  (getElement<HTMLInputElement>('fc-gradient-period')).value = String(p.gradientPeriodMs);
  (getElement<HTMLInputElement>('fc-gradient-op1')).value    = String(p.gradientOpacity1);
  (getElement<HTMLInputElement>('fc-gradient-op2')).value    = String(p.gradientOpacity2);
  (getElement<HTMLInputElement>('fc-gradient-offset')).value = String(p.gradientOffset);
  (getElement<HTMLInputElement>('fc-blend-hardlight')).checked = p.blendHardLight;
  (getElement<HTMLInputElement>('fc-sheen-enabled')).checked = p.sheenEnabled;
  (getElement<HTMLInputElement>('fc-sheen-period')).value    = String(p.sheenPeriodMs);
  (getElement<HTMLInputElement>('fc-sheen-width')).value     = String(p.sheenWidth);
  (getElement<HTMLInputElement>('fc-sheen-brightness')).value = String(p.sheenBrightness);
  p.gradient1Colors.forEach((c, i) => { (getElement<HTMLInputElement>(`fc-g1-${i}`)).value = c; });
  p.gradient2Colors.forEach((c, i) => { (getElement<HTMLInputElement>(`fc-g2-${i}`)).value = c; });
  updateValueLabels();
}

function updateValueLabels() {
  const p = workingFoilParams;
  const set = (id: string, v: string | number) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(v);
  };
  set('fc-glitter-count-val',   p.glitterCount);
  set('fc-glitter-period-val',  p.glitterPeriodMs);
  set('fc-glitter-alpha-val',   p.glitterAlpha.toFixed(2));
  set('fc-hatch-spacing-val',   p.hatchSpacing);
  set('fc-hatch-opacity-val',   p.hatchOpacity.toFixed(3));
  set('fc-gradient-period-val', p.gradientPeriodMs);
  set('fc-gradient-op1-val',    p.gradientOpacity1.toFixed(2));
  set('fc-gradient-op2-val',    p.gradientOpacity2.toFixed(2));
  set('fc-gradient-offset-val', p.gradientOffset.toFixed(2));
  set('fc-sheen-period-val',    p.sheenPeriodMs);
  set('fc-sheen-width-val',     p.sheenWidth.toFixed(2));
  set('fc-sheen-brightness-val', p.sheenBrightness.toFixed(2));
}

function readSlidersToParams() {
  const num = (id: string) => parseFloat((getElement<HTMLInputElement>(id)).value);
  const chk = (id: string) => (getElement<HTMLInputElement>(id)).checked;
  const col = (id: string) => (getElement<HTMLInputElement>(id)).value;
  workingFoilParams = {
    glitterCount:     num('fc-glitter-count'),
    glitterPeriodMs:  num('fc-glitter-period'),
    glitterAlpha:     num('fc-glitter-alpha'),
    glitterFullCard:  chk('fc-glitter-fullcard'),
    hatchEnabled:     chk('fc-hatch-enabled'),
    hatchSpacing:     num('fc-hatch-spacing'),
    hatchOpacity:     num('fc-hatch-opacity'),
    gradientPeriodMs: num('fc-gradient-period'),
    gradientOpacity1: num('fc-gradient-op1'),
    gradientOpacity2: num('fc-gradient-op2'),
    gradientOffset:   num('fc-gradient-offset'),
    blendHardLight:   chk('fc-blend-hardlight'),
    sheenEnabled:     chk('fc-sheen-enabled'),
    sheenPeriodMs:    num('fc-sheen-period'),
    sheenWidth:       num('fc-sheen-width'),
    sheenBrightness:  num('fc-sheen-brightness'),
    gradient1Colors:  [col('fc-g1-0'), col('fc-g1-1'), col('fc-g1-2'), col('fc-g1-3'), col('fc-g1-4'), col('fc-g1-5')],
    gradient2Colors:  [col('fc-g2-0'), col('fc-g2-1'), col('fc-g2-2'), col('fc-g2-3')],
  };
  updateValueLabels();
}

function drawPreviewFrame(now: number) {
  previewCtx.fillStyle = '#1a1a2e';
  previewCtx.fillRect(0, 0, 204, 204);
  previewCtx.save();
  previewCtx.scale(3, 3);
  drawCustomFoil(previewCtx, 0, 0, workingFoilParams, now);
  previewCtx.restore();
  previewRaf = requestAnimationFrame(drawPreviewFrame);
}

function startFoilPreview() {
  cancelAnimationFrame(previewRaf);
  previewRaf = requestAnimationFrame(drawPreviewFrame);
}

function stopFoilPreview() {
  cancelAnimationFrame(previewRaf);
  previewRaf = 0;
}

for (const id of [
  'fc-glitter-count','fc-glitter-period','fc-glitter-alpha','fc-glitter-fullcard',
  'fc-hatch-enabled','fc-hatch-spacing','fc-hatch-opacity',
  'fc-gradient-period','fc-gradient-op1','fc-gradient-op2','fc-gradient-offset','fc-blend-hardlight',
  'fc-sheen-enabled','fc-sheen-period','fc-sheen-width','fc-sheen-brightness',
  'fc-g1-0','fc-g1-1','fc-g1-2','fc-g1-3','fc-g1-4','fc-g1-5',
  'fc-g2-0','fc-g2-1','fc-g2-2','fc-g2-3',
]) {
  getElement(id).addEventListener('input', () => { readSlidersToParams(); });
}

getElement('foil-creator-btn').addEventListener('click', () => {
  syncSlidersToParams(workingFoilParams);
  ui.showFoilCreator();
  startFoilPreview();
});

getElement('foil-creator-back-btn').addEventListener('click', () => {
  stopFoilPreview();
  ui.showSettings();
});

getElement('foil-save-btn').addEventListener('click', () => {
  saveCustomFoilParams(workingFoilParams);
  game.setCustomFoilParams(workingFoilParams);
  foilSelect.value = '3';
  game.setFoilStyle(3);
  if (inRoom) photon.sendFoilPick(3, workingFoilParams);
  stopFoilPreview();
  ui.showSettings();
});

// ── debug toggle ──────────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.key !== '`') return;
  debugMode = !debugMode;
  getElement<HTMLInputElement>('room-name').style.display = debugMode ? '' : 'none';
  getElement<HTMLInputElement>('cpu-check').style.display = debugMode ? '' : 'none';
  getElement('cpu-label').style.display = debugMode ? '' : 'none';
});
