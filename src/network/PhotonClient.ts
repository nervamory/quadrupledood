import { ConnectionProtocol, LoadBalancing, PhotonPeer } from 'photon-realtime';
import type { GameState, DeckType } from '../game/types';
import type { CustomFoilParams } from '../foil/customFoil';

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
const EV_HOVER      = 4;
const EV_READY      = 5;
const EV_FOIL_PICK  = 6;
const EV_REMATCH    = 7;
const EV_DRAG       = 8;
const EV_RESUME     = 9;

export type NetworkCallbacks = {
  onJoined: (actorNr: number, resumed: boolean) => void;
  onResume: (state: GameState, score: Record<number, number>) => void;
  onResumeFailed: () => void;
  onPlayerJoined: (actorNr: number) => void;
  onPlayerLeft: (actorNr: number) => void;
  onGameStart: (state: GameState) => void;
  onCardPlaced: (actorNr: number, cardId: string, row: number, col: number) => void;
  onDeckPick: (actorNr: number, deck: DeckType) => void;
  onLobbyUpdate: (playerCount: number) => void;
  onStatusChange: (msg: string) => void;
  onDisconnected: () => void;
  onOpponentHover: (idx: number | null) => void;
  onOpponentDrag: (drag: { idx: number; x: number; y: number } | null) => void;
  onReady: (actorNr: number, deck: DeckType) => void;
  onFoilPick?: (style: number, params: CustomFoilParams) => void;
  onRematch?: () => void;
};

const MAX_RETRIES = 3;
const ROOM_CREATE = { maxPlayers: 2, playerTTL: 90000, emptyRoomLiveTime: 90000 };
const JOIN_MISS = new Set([32765, 32764, 32758, 32750, 32749, 32748, 32747, 32746]);

export class PhotonClient {
  private lbc: LoadBalancing.LoadBalancingClient;
  private pendingRoom: string | null = null;
  private pendingReconnectRoom: string | null = null;
  private roomName: string | null = null;
  private pendingMatchmaking = false;
  private inLobby = false;
  private lobbyTimer: ReturnType<typeof setInterval> | null = null;
  private intentionalDisconnect = false;
  private retryCount = 0;
  private gaveUp = false;
  private started = false;
  private boundUserId: string | null = null;
  private restartUserId: string | null | undefined = undefined;
  private pendingResumeRoom: string | null = null;
  private resuming = false;

  constructor(private cb: NetworkCallbacks) {
    this.lbc = new LoadBalancing.LoadBalancingClient(
      ConnectionProtocol.Wss,
      APP_ID,
      APP_VERSION
    );
    this.wire();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.gaveUp) {
        this.gaveUp = false;
        this.retryCount = 0;
        if (this.roomName) this.pendingReconnectRoom = this.roomName;
        this.cb.onStatusChange('rechanneling…');
        this.lbc.connectToRegionMaster('us');
      }
    });
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
        const restart = this.restartUserId;
        this.restartUserId = undefined;
        if (restart !== undefined) {
          this.intentionalDisconnect = false;
          this.retryCount = 0;
          this.startWith(restart);
          return;
        }
        if (!this.intentionalDisconnect) {
          this.cb.onDisconnected();
          if (this.retryCount < MAX_RETRIES && this.roomName) {
            this.retryCount++;
            this.pendingReconnectRoom = this.roomName;
            this.cb.onStatusChange('rechanneling…');
            setTimeout(() => this.lbc.connectToRegionMaster('us'), 1500);
          } else {
            this.gaveUp = true;
            this.cb.onStatusChange('connection lost — refresh to reconnect');
          }
        } else {
          this.retryCount = 0;
          this.pendingReconnectRoom = null;
        }
        this.intentionalDisconnect = false;
        return;
      }

      if (state === State.JoinedLobby) {
        this.retryCount = 0;
        this.gaveUp = false;
      }

      if (this.inLobby && !wasInLobby) {
        this.updateLobbyCount();

        if (this.pendingReconnectRoom) {
          const room = this.pendingReconnectRoom;
          this.pendingReconnectRoom = null;
          this.joinRejoin(room);
        } else if (this.pendingResumeRoom) {
          const room = this.pendingResumeRoom;
          this.pendingResumeRoom = null;
          this.joinRejoin(room);
        } else if (this.pendingRoom) {
          const room = this.pendingRoom;
          this.pendingRoom = null;
          this.lbc.joinRoom(room, { createIfNotExists: true }, ROOM_CREATE); // debug path
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
      this.roomName = (this.lbc.myRoom() as { name?: string } | null)?.name ?? null;
      const resumed = this.resuming;
      this.resuming = false;
      this.pendingResumeRoom = null;
      const localNr = this.lbc.myActor().actorNr;
      this.cb.onJoined(localNr, resumed);
      const actors = this.lbc.myRoomActors() as Record<number, { actorNr: number }>;
      for (const nr in actors) {
        const n = parseInt(nr);
        if (n !== localNr) this.cb.onPlayerJoined(n);
      }
    };

    this.lbc.onActorJoin = (actor: { actorNr: number }) => {
      this.cb.onPlayerJoined(actor.actorNr);
    };

    this.lbc.onActorLeave = (actor: { actorNr: number }, cleanup: boolean) => {
      if (cleanup) return;
      this.cb.onPlayerLeft(actor.actorNr);
    };

    this.lbc.onActorSuspend = (actor: { actorNr: number }) => {
      this.cb.onPlayerLeft(actor.actorNr);
    };

    this.lbc.onEvent = (code: number, content: unknown, actorNr: number) => {
      if (code === EV_GAME_START) {
        this.cb.onGameStart(JSON.parse(content as string) as GameState);
      } else if (code === EV_PLACE_CARD) {
        const { cardId, row, col } = content as { cardId: string; row: number; col: number };
        this.cb.onCardPlaced(actorNr, cardId, row, col);
      } else if (code === EV_DECK_PICK) {
        const { deck } = content as { deck: DeckType };
        this.cb.onDeckPick(actorNr, deck);
      } else if (code === EV_HOVER) {
        const { idx } = content as { idx: number | null };
        this.cb.onOpponentHover(idx);
      } else if (code === EV_DRAG) {
        const drag = content as { idx?: number | null; x?: number; y?: number } | null;
        if (drag && typeof drag.idx === 'number' && drag.idx >= 0 && drag.x != null && drag.y != null) {
          this.cb.onOpponentDrag({ idx: drag.idx, x: drag.x, y: drag.y });
        } else {
          this.cb.onOpponentDrag(null);
        }
      } else if (code === EV_READY) {
        const { deck } = content as { deck: DeckType };
        this.cb.onReady(actorNr, deck);
      } else if (code === EV_FOIL_PICK) {
        const { style, params } = content as { style: number; params: string };
        this.cb.onFoilPick?.(style, JSON.parse(params) as CustomFoilParams);
      } else if (code === EV_REMATCH) {
        this.cb.onRematch?.();
      } else if (code === EV_RESUME) {
        const parsed = JSON.parse(content as string) as { state: GameState; score: Record<string, number> };
        const score: Record<number, number> = {};
        for (const [nr, wins] of Object.entries(parsed.score ?? {})) score[Number(nr)] = wins;
        this.cb.onResume(parsed.state, score);
      }
    };

    this.lbc.onError = (errorCode: number, errorMsg: string) => {
      // 1003/1004 = WebSocket "unsupported data"/"reserved" close codes fired on clean disconnects.
      // 2003/2004 = Photon internal disconnect codes (e.g. leaving a room intentionally).
      // All four are expected non-fatal conditions; surface anything else to the user.
      if (errorCode === 1003 || errorCode === 1004 || errorCode === 2003 || errorCode === 2004) return;
      if (this.resuming && JOIN_MISS.has(errorCode)) {
        this.resuming = false;
        this.pendingResumeRoom = null;
        this.cb.onResumeFailed();
        return;
      }
      this.cb.onStatusChange(`Error ${errorCode}: ${errorMsg}`);
    };
  }

  private updateLobbyCount() {
    const rooms = this.lbc.availableRooms();
    const count = rooms.reduce((sum, r) => sum + r.playerCount, 0);
    this.cb.onLobbyUpdate(count);
  }

  private joinRejoin(room: string) {
    this.resuming = true;
    this.cb.onStatusChange('rejoining match…');
    this.lbc.joinRoom(room, { rejoin: true }, {});
  }

  private startWith(userId: string | null) {
    this.started = true;
    this.boundUserId = userId;
    this.lbc.setUserId(userId ?? `guest-${Math.random().toString(36).slice(2)}`);
    this.lbc.connectToRegionMaster('us');
  }

  /** Connect as this account. A logged-in id is what a later refresh uses to reclaim the seat. */
  setAccountUser(userId: string | null) {
    if (!this.started) {
      this.startWith(userId);
      return;
    }
    if (this.boundUserId === userId) return;
    if (this.inRoomName()) return;
    this.restartUserId = userId;
    this.intentionalDisconnect = true;
    this.lbc.disconnect();
  }

  queueResume(room: string) {
    this.pendingResumeRoom = room;
  }

  clearResume() {
    this.pendingResumeRoom = null;
    this.resuming = false;
  }

  private inRoomName(): boolean {
    return this.roomName !== null && !this.inLobby;
  }

  private doMatchmaking() {
    const rooms = this.lbc.availableRooms();
    const open = rooms.find(r => r.playerCount === 1 && r.isOpen);
    if (open) {
      this.lbc.joinRoom(open.name, {}, ROOM_CREATE);
    } else {
      const roomName = Math.random().toString(36).slice(2, 10);
      this.lbc.joinRoom(roomName, { createIfNotExists: true }, ROOM_CREATE);
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
      this.lbc.joinRoom(roomName, { createIfNotExists: true }, ROOM_CREATE);
    } else {
      this.pendingRoom = roomName;
      this.lbc.connectToRegionMaster('us');
    }
  }

  sendGameStart(state: GameState) {
    this.lbc.raiseEvent(EV_GAME_START, JSON.stringify(state));
  }

  sendPlaceCard(cardId: string, row: number, col: number) {
    this.lbc.raiseEvent(EV_PLACE_CARD, { cardId, row, col });
  }

  sendDeckPick(deck: DeckType) {
    this.lbc.raiseEvent(EV_DECK_PICK, { deck });
  }

  sendHover(idx: number | null) {
    this.lbc.raiseEvent(EV_HOVER, { idx });
  }

  sendDrag(drag: { idx: number; x: number; y: number } | null) {
    this.lbc.raiseEvent(EV_DRAG, drag ?? { idx: null });
  }

  sendReady(deck: DeckType) {
    this.lbc.raiseEvent(EV_READY, { deck });
  }

  sendFoilPick(style: number, params: CustomFoilParams) {
    this.lbc.raiseEvent(EV_FOIL_PICK, { style, params: JSON.stringify(params) });
  }

  sendRematch() {
    this.lbc.raiseEvent(EV_REMATCH, {});
  }

  sendResume(state: GameState, score: Record<number, number>) {
    this.lbc.raiseEvent(EV_RESUME, JSON.stringify({ state, score }));
  }

  leave() {
    this.intentionalDisconnect = true;
    this.pendingRoom = null;
    this.pendingReconnectRoom = null;
    this.pendingResumeRoom = null;
    this.resuming = false;
    this.roomName = null;
    this.lbc.leaveRoom();
  }

  closeRoom() {
    const room = this.lbc.myRoom() as { setIsOpen?: (open: boolean) => void } | null;
    room?.setIsOpen?.(false);
  }

  currentRoom(): string | null {
    return this.roomName;
  }

  hasOtherPlayer(): boolean {
    const me = this.lbc.myActor().actorNr;
    return this.actorList().some(actor => actor.actorNr !== me);
  }

  hasActiveOpponent(): boolean {
    const me = this.lbc.myActor().actorNr;
    return this.actorList().some(actor => actor.actorNr !== me && !actor.suspended && !actor.isSuspended?.());
  }

  private actorList(): { actorNr: number; suspended?: boolean; isSuspended?: () => boolean }[] {
    const actors = this.lbc.myRoomActors() as Record<number, { actorNr: number; suspended?: boolean; isSuspended?: () => boolean }>;
    return Object.values(actors);
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
    return Object.values(actors).map(a => a.actorNr).sort((a, b) => a - b);
  }
}
