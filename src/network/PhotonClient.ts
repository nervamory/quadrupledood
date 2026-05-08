import { ConnectionProtocol, LoadBalancing, PhotonPeer } from 'photon-realtime';
import type { GameState, DeckType } from '../game/types';

class BrowserSocket {
  private socket: WebSocket;
  onopen: () => void = () => {};
  onerror: (err: Event) => void = () => {};
  onclose: (ev: CloseEvent) => void = () => {};
  onmessage: (msg: { data: unknown }) => void = () => {};

  constructor(uri: string, prot?: string) {
    this.socket = new WebSocket(uri, prot ? [prot] : undefined);
    this.socket.binaryType = 'arraybuffer';
    this.socket.onopen = () => this.onopen();
    this.socket.onerror = (err) => this.onerror(err);
    this.socket.onclose = (ev) => this.onclose(ev);
    this.socket.onmessage = (ev) => this.onmessage({ data: ev.data });
  }

  send(data: string | ArrayBuffer) { this.socket.send(data); }
  close() { this.socket.close(); }
}

(PhotonPeer as unknown as { setWebSocketImpl: (cls: unknown) => void }).setWebSocketImpl(BrowserSocket);

export const APP_ID = '23396d7f-af3c-4df7-89ec-a2f36fca5404';
const APP_VERSION = '1.0';
const EV_GAME_START = 1;
const EV_PLACE_CARD = 2;
const EV_DECK_PICK  = 3;

export type NetworkCallbacks = {
  onJoined: (actorNr: number) => void;
  onPlayerJoined: (actorNr: number) => void;
  onPlayerLeft: (actorNr: number) => void;
  onGameStart: (state: GameState) => void;
  onCardPlaced: (actorNr: number, cardId: string, row: number, col: number) => void;
  onDeckPick: (actorNr: number, deck: DeckType) => void;
  onLobbyUpdate: (playerCount: number) => void;
  onStatusChange: (msg: string) => void;
  onDisconnected: () => void;
};

export class PhotonClient {
  private lbc: LoadBalancing.LoadBalancingClient;
  private pendingRoom: string | null = null;
  private pendingMatchmaking = false;
  private inLobby = false;
  private lobbyTimer: ReturnType<typeof setInterval> | null = null;
  private intentionalDisconnect = false;

  constructor(private cb: NetworkCallbacks) {
    this.lbc = new LoadBalancing.LoadBalancingClient(
      ConnectionProtocol.Wss,
      APP_ID,
      APP_VERSION
    );
    this.wire();
    this.lbc.connectToRegionMaster('us');
  }

  private wire() {
    const State = LoadBalancing.LoadBalancingClient.State;

    this.lbc.onStateChange = (state: number) => {
      const wasInLobby = this.inLobby;
      this.inLobby = state === State.JoinedLobby;

      if (state === State.Disconnected) {
        if (this.lobbyTimer) { clearInterval(this.lobbyTimer); this.lobbyTimer = null; }
        this.inLobby = false;
        this.pendingMatchmaking = false;
        this.pendingRoom = null;
        if (!this.intentionalDisconnect) {
          this.cb.onDisconnected();
          this.cb.onStatusChange('reconnecting…');
          setTimeout(() => this.lbc.connectToRegionMaster('us'), 1500);
        }
        this.intentionalDisconnect = false;
        return;
      }

      if (this.inLobby && !wasInLobby) {
        this.updateLobbyCount();

        if (this.pendingRoom) {
          const room = this.pendingRoom;
          this.pendingRoom = null;
          this.lbc.joinRoom(room, { createIfNotExists: true }, { playerTtl: 300000, emptyRoomTtl: 300000 });
        } else if (this.pendingMatchmaking) {
          this.pendingMatchmaking = false;
          this.doMatchmaking();
        } else {
          this.lobbyTimer = setInterval(() => this.updateLobbyCount(), 2000);
        }
      }

      if (!this.inLobby && wasInLobby) {
        if (this.lobbyTimer) { clearInterval(this.lobbyTimer); this.lobbyTimer = null; }
      }
    };

    this.lbc.onJoinRoom = () => {
      const localNr = this.lbc.myActor().actorNr;
      this.cb.onJoined(localNr);
      const actors = this.lbc.myRoomActors() as Record<number, { actorNr: number }>;
      for (const nr in actors) {
        const n = parseInt(nr);
        if (n !== localNr) this.cb.onPlayerJoined(n);
      }
    };

    this.lbc.onActorJoin = (actor: { actorNr: number }) => {
      this.cb.onPlayerJoined(actor.actorNr);
    };

    this.lbc.onActorLeave = (actor: { actorNr: number }) => {
      this.cb.onPlayerLeft(actor.actorNr);
    };

    this.lbc.onEvent = (code: number, content: unknown, actorNr: number) => {
      if (code === EV_GAME_START) {
        this.cb.onGameStart(content as GameState);
      } else if (code === EV_PLACE_CARD) {
        const { cardId, row, col } = content as { cardId: string; row: number; col: number };
        this.cb.onCardPlaced(actorNr, cardId, row, col);
      } else if (code === EV_DECK_PICK) {
        const { deck } = content as { deck: DeckType };
        this.cb.onDeckPick(actorNr, deck);
      }
    };

    this.lbc.onError = (errorCode: number, errorMsg: string) => {
      if (errorCode === 1003 || errorCode === 2003 || errorCode === 2004) return;
      this.cb.onStatusChange(`Error ${errorCode}: ${errorMsg}`);
    };
  }

  private updateLobbyCount() {
    const rooms = this.lbc.availableRooms();
    const count = rooms.reduce((sum, r) => sum + r.playerCount, 0);
    this.cb.onLobbyUpdate(count);
  }

  private doMatchmaking() {
    const rooms = this.lbc.availableRooms();
    const open = rooms.find(r => r.playerCount === 1);
    if (open) {
      this.lbc.joinRoom(open.name, {}, { playerTtl: 300000, emptyRoomTtl: 300000 });
    } else {
      const roomName = Math.random().toString(36).slice(2, 10);
      this.lbc.joinRoom(roomName, { createIfNotExists: true }, { playerTtl: 300000, emptyRoomTtl: 300000 });
    }
  }

  joinMatchmaking() {
    if (this.inLobby) {
      this.doMatchmaking();
    } else {
      this.pendingMatchmaking = true;
    }
  }

  // Debug mode: join a specific named room
  connectAndJoin(roomName: string) {
    if (this.inLobby) {
      this.lbc.joinRoom(roomName, { createIfNotExists: true }, { playerTtl: 300000, emptyRoomTtl: 300000 });
    } else {
      this.pendingRoom = roomName;
      this.lbc.connectToRegionMaster('us');
    }
  }

  sendGameStart(state: GameState) {
    this.lbc.raiseEvent(EV_GAME_START, state);
  }

  sendPlaceCard(cardId: string, row: number, col: number) {
    this.lbc.raiseEvent(EV_PLACE_CARD, { cardId, row, col });
  }

  sendDeckPick(deck: DeckType) {
    this.lbc.raiseEvent(EV_DECK_PICK, { deck });
  }

  leave() {
    this.intentionalDisconnect = true;
    this.lbc.leaveRoom();
  }

  get actorNr(): number {
    return this.lbc.myActor().actorNr;
  }

  get playerCount(): number {
    return (this.lbc.myRoom()?.playerCount as number | undefined) ?? 0;
  }

  get isMaster(): boolean {
    return this.lbc.myActor().actorNr === this.lbc.myRoomMasterActorNr();
  }

  get allActorNrs(): number[] {
    const actors = this.lbc.myRoomActors() as Record<number, { actorNr: number }>;
    return Object.values(actors).map(a => a.actorNr);
  }
}
