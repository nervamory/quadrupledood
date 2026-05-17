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

// Match state
let matchScore: Record<number, number> = {};
let myPlayedDeck: DeckType | null = null;   // deck I used in the last completed game
let myReadyDeck: DeckType | null = null;    // deck I signalled ready with
let oppReadyDeck: DeckType | null = null;   // deck opponent signalled ready with
let endTransitionTimer: ReturnType<typeof setTimeout> | null = null;

function getSelectedDeck(): DeckType {
  return getElement<HTMLSelectElement>('deck-select').value as DeckType;
}

// ── match helpers ─────────────────────────────────────────────────────────────

function clearEndTimer() {
  if (endTransitionTimer !== null) { clearTimeout(endTransitionTimer); endTransitionTimer = null; }
}

function startGame(myDeck: DeckType, oppDeckUsed: DeckType) {
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
  if (!photon.isMaster || photon.playerCount !== 2 || oppDeck === null) return;
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
    game.startIdleSpin();
    ui.showGame();
  },
  onPlayerJoined: (_actorNr) => {
    photon.sendDeckPick(getSelectedDeck());
    tryStartGame();
  },
  onPlayerLeft: (_actorNr) => {
    if (!inRoom) return;
    clearEndTimer();
    oppDeck = null;
    oppReadyDeck = null;
    myReadyDeck = null;
    gameState = null;
    matchScore = {};
    game.reset();
    inRoom = false;
    photon.leave();
    ui.showLobby();
    ui.setStatus('opponent left');
  },
  onGameStart: (state) => {
    gameState = state;
    myPlayedDeck = myReadyDeck ?? getSelectedDeck();
    game.setMatchScore(matchScore);
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
  onLobbyUpdate: (count) => {
    ui.setStatus(`${count} ${count === 1 ? 'player' : 'players'} currently sacrificing`);
  },
  onStatusChange: (msg) => ui.setStatus(msg),
  onDisconnected: () => {
    clearEndTimer();
    inRoom = false;
    gameState = null;
    oppDeck = null;
    oppReadyDeck = null;
    myReadyDeck = null;
    matchScore = {};
    game.reset();
    ui.showLobby();
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
  gameState = placeCard(gameState, photon.actorNr, cardId, row, col);
  game.setState(gameState);
  photon.sendPlaceCard(cardId, row, col);
  if (gameState.phase === 'finished') handleGameEnd(gameState);
};

// ── lobby button ──────────────────────────────────────────────────────────────

getElement('join-btn').addEventListener('click', () => {
  if (debugMode) {
    const roomName = getElement<HTMLInputElement>('room-name').value.trim();
    if (!roomName) return;
    photon.connectAndJoin(roomName);
  } else {
    photon.joinMatchmaking();
  }
});

getElement('leave-btn').addEventListener('click', () => {
  clearEndTimer();
  inRoom = false;
  oppDeck = null;
  myReadyDeck = null;
  oppReadyDeck = null;
  matchScore = {};
  photon.leave();
  game.reset();
  gameState = null;
  ui.showLobby();
});

// ── between-games buttons ─────────────────────────────────────────────────────

getElement('ready-btn').addEventListener('click', () => {
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

getElement('between-leave-btn').addEventListener('click', () => {
  clearEndTimer();
  inRoom = false;
  oppDeck = null;
  myReadyDeck = null;
  oppReadyDeck = null;
  matchScore = {};
  photon.leave();
  game.reset();
  gameState = null;
  ui.showLobby();
});

// ── match-over buttons ────────────────────────────────────────────────────────

getElement('rematch-btn').addEventListener('click', () => {
  matchScore = {};
  myPlayedDeck = null;
  myReadyDeck = null;
  oppReadyDeck = null;
  ui.showBetweenGames({ myWins: 0, oppWins: 0, lastResult: 'draw', lockedDeck: null });
});

getElement('matchover-leave-btn').addEventListener('click', () => {
  clearEndTimer();
  inRoom = false;
  oppDeck = null;
  myReadyDeck = null;
  oppReadyDeck = null;
  matchScore = {};
  photon.leave();
  game.reset();
  gameState = null;
  ui.showLobby();
});

// ── settings ──────────────────────────────────────────────────────────────────

const foilSelect = getElement<HTMLSelectElement>('foil-style-select');
foilSelect.value = String(Math.min(3, Math.max(0, parseInt(localStorage.getItem('foilStyle') ?? '2', 10))));
foilSelect.addEventListener('change', () => game.setFoilStyle(parseInt(foilSelect.value, 10)));

const deckSelect    = getElement<HTMLSelectElement>('deck-select');
const prefDeckSelect = getElement<HTMLSelectElement>('pref-deck-select');
const savedDeck = localStorage.getItem('deckPref') ?? 'random';
deckSelect.value = savedDeck;
prefDeckSelect.value = savedDeck;
prefDeckSelect.addEventListener('change', () => {
  localStorage.setItem('deckPref', prefDeckSelect.value);
  deckSelect.value = prefDeckSelect.value;
});

getElement('settings-btn').addEventListener('click', () => ui.showSettings());
getElement('settings-back-btn').addEventListener('click', () => ui.showLobby());

// ── foil creator ──────────────────────────────────────────────────────────────

let workingFoilParams: CustomFoilParams = loadCustomFoilParams();
let previewRaf = 0;

const previewCanvas = getElement<HTMLCanvasElement>('foil-preview');
const previewCtx = previewCanvas.getContext('2d')!;

function syncSlidersToParams(p: CustomFoilParams) {
  (getElement<HTMLInputElement>('fc-glitter-count')).value   = String(p.glitterCount);
  (getElement<HTMLInputElement>('fc-glitter-period')).value  = String(p.glitterPeriodMs);
  (getElement<HTMLInputElement>('fc-glitter-alpha')).value   = String(p.glitterAlpha);
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
  workingFoilParams = {
    glitterCount:     num('fc-glitter-count'),
    glitterPeriodMs:  num('fc-glitter-period'),
    glitterAlpha:     num('fc-glitter-alpha'),
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
  'fc-glitter-count','fc-glitter-period','fc-glitter-alpha',
  'fc-hatch-enabled','fc-hatch-spacing','fc-hatch-opacity',
  'fc-gradient-period','fc-gradient-op1','fc-gradient-op2','fc-gradient-offset','fc-blend-hardlight',
  'fc-sheen-enabled','fc-sheen-period','fc-sheen-width','fc-sheen-brightness',
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
  stopFoilPreview();
  ui.showSettings();
});

// ── debug toggle ──────────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.key !== '`') return;
  debugMode = !debugMode;
  getElement<HTMLInputElement>('room-name').style.display = debugMode ? '' : 'none';
});
