import { PhotonClient } from './network/PhotonClient';
import { Game } from './game/Game';
import { UI } from './ui/UI';
import { initGame, placeCard } from './game/gameLogic';
import type { GameState, DeckType } from './game/types';

const ui = new UI();
const game = new Game(document.getElementById('game-canvas') as HTMLCanvasElement);

let gameState: GameState | null = null;
let oppDeck: DeckType | null = null;
let debugMode = false;

function getSelectedDeck(): DeckType {
  return (document.getElementById('deck-select') as HTMLSelectElement).value as DeckType;
}

function tryStartGame() {
  if (!photon.isMaster || photon.playerCount !== 2 || oppDeck === null) return;
  const [a1, a2] = photon.allActorNrs;
  const myDeck = getSelectedDeck();
  const oppNr = photon.allActorNrs.find(n => n !== photon.actorNr)!;
  const deckOf: Record<number, DeckType> = {
    [photon.actorNr]: myDeck,
    [oppNr]: oppDeck,
  };
  const state = initGame(a1, a2, deckOf[a1], deckOf[a2]);
  gameState = state;
  game.setState(state);
  photon.sendGameStart(state);
  oppDeck = null;
}

const photon = new PhotonClient({
  onJoined: (actorNr) => {
    game.setLocalActor(actorNr);
    ui.showGame();
  },
  onPlayerJoined: (_actorNr) => {
    photon.sendDeckPick(getSelectedDeck());
    tryStartGame();
  },
  onPlayerLeft: (_actorNr) => {
    oppDeck = null;
    if (gameState?.phase !== 'finished') {
      gameState = null;
      game.reset();
      photon.leave();
      ui.showLobby();
      ui.setStatus('opponent left');
    }
  },
  onGameStart: (state) => {
    gameState = state;
    game.setState(state);
  },
  onCardPlaced: (actorNr, cardId, row, col) => {
    if (!gameState) return;
    gameState = placeCard(gameState, actorNr, cardId, row, col);
    game.setState(gameState);
  },
  onDeckPick: (_actorNr, deck) => {
    if (!photon.isMaster) return;
    oppDeck = deck;
    tryStartGame();
  },
  onLobbyUpdate: (count) => {
    ui.setStatus(`${count} ${count === 1 ? 'player' : 'players'} currently sacrificing`);
  },
  onStatusChange: (msg) => ui.setStatus(msg),
  onDisconnected: () => {
    gameState = null;
    oppDeck = null;
    game.reset();
    ui.showLobby();
  },
  onOpponentHover: (idx) => {
    game.setOppHover(idx);
  },
});

game.onHoverChange = (idx) => {
  photon.sendHover(idx);
};

game.onPlaceCard = (cardId, row, col) => {
  if (!gameState) return;
  gameState = placeCard(gameState, photon.actorNr, cardId, row, col);
  game.setState(gameState);
  photon.sendPlaceCard(cardId, row, col);
};

document.getElementById('join-btn')!.addEventListener('click', () => {
  if (debugMode) {
    const roomName = (document.getElementById('room-name') as HTMLInputElement).value.trim();
    if (!roomName) return;
    photon.connectAndJoin(roomName);
  } else {
    photon.joinMatchmaking();
  }
});

document.getElementById('leave-btn')!.addEventListener('click', () => {
  oppDeck = null;
  photon.leave();
  game.reset();
  gameState = null;
  ui.showLobby();
});

// Backtick toggles debug mode: shows room name input for direct room join
document.addEventListener('keydown', (e) => {
  if (e.key !== '`') return;
  debugMode = !debugMode;
  (document.getElementById('room-name') as HTMLInputElement).style.display = debugMode ? '' : 'none';
});
