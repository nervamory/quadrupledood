declare module 'photon-realtime' {
  export const ConnectionProtocol: { Ws: 0; Wss: 1 };
  export const PhotonPeer: object;
  export namespace LoadBalancing {
    class LoadBalancingClient {
      static readonly State: Record<string, number>;
      constructor(protocol: number, appId: string, appVersion: string);
      setLogLevel(level: number): void;
      onStateChange: (state: number) => void;
      onJoinRoom: () => void;
      onActorJoin: (actor: { actorNr: number }) => void;
      onActorLeave: (actor: { actorNr: number }, cleanup: boolean) => void;
      onEvent: (code: number, content: unknown, actorNr: number) => void;
      onError: (errorCode: number, errorMsg: string) => void;
      connectToRegionMaster(region: string): void;
      joinRoom(roomName: string, joinOptions: { createIfNotExists?: boolean; rejoin?: boolean }, createOptions: object): void;
      raiseEvent(code: number, data: unknown): void;
      leaveRoom(): void;
      disconnect(): void;
      isJoinedToRoom(): boolean;
      myActor(): { actorNr: number };
      myRoom(): { playerCount: number; name: string } | null;
      myRoomActors(): Record<number, { actorNr: number }>;
      myRoomMasterActorNr(): number;
      availableRooms(): Array<{ name: string; playerCount: number; maxPlayers: number; isOpen: boolean }>;
    }
  }
}
