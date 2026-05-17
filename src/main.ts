import { PhotonClient } from './network/PhotonClient';
import { Game } from './game/Game';
import { UI } from './ui/UI';
import { initGame, placeCard } from './game/gameLogic';
import type { GameState, DeckType } from './game/types';

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
foilSelect.value = String(Math.min(2, Math.max(0, parseInt(localStorage.getItem('foilStyle') ?? '2', 10))));
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

// ── debug toggle ──────────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.key !== '`') return;
  debugMode = !debugMode;
  getElement<HTMLInputElement>('room-name').style.display = debugMode ? '' : 'none';
});
