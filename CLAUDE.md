# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Vite dev server at localhost:5173 (hot reload)
npm run build     # tsc && vite build — must pass before committing
npm run preview   # Preview production build

node test-oni.mjs # Standalone test for oni hand placement fallback logic
```

There is no test suite beyond `test-oni.mjs`. TypeScript strict mode (`tsconfig.json`) acts as the primary correctness gate — always run `npm run build` after changes.

## Architecture

**Layer separation is strict:**

- `src/game/gameLogic.ts` — pure, side-effect-free game logic. All capture resolution, card abilities, and state transitions live here. Never import from Game.ts or PhotonClient.ts. The same code runs on both clients.
- `src/game/Game.ts` — canvas renderer and input handler only. Reads `GameState`, never mutates it directly. Fires `onPlaceCard` and `onHoverChange` callbacks into `main.ts`.
- `src/network/PhotonClient.ts` — thin wrapper around Photon Realtime. Raises/receives 4 events: `EV_GAME_START`, `EV_PLACE_CARD`, `EV_DECK_PICK`, `EV_HOVER`. No game logic here.
- `src/main.ts` — orchestrates all three layers. Owns `gameState` (the single source of truth). Calls `placeCard()` locally and sends the move; receives opponent moves via `onCardPlaced` and applies them the same way.
- `src/ui/UI.ts` — trivially thin; just toggles `.active` CSS class between `#lobby-screen` and `#game-screen`.

**Master player pattern:** Photon assigns actor numbers starting from 1. The player with the lowest actor number (`isMaster`) is responsible for initializing game state and sending it via `EV_GAME_START`. The non-master waits for this event before the spin animation begins. Both clients then run identical deterministic logic on all subsequent moves — no state is re-sent after game start except the move events.

**First-player determination:** `tryStartGame()` in `main.ts` picks `firstPlayer` with `Math.random()` and passes it explicitly to `initGame()`. This value is snapshotted into `spinAnim.firstPlayer` when `game.setState()` is called. Do not move `Math.random()` back into `initGame()` — it must be determined once and flow through unchanged.

**Deterministic sync:** `cardHash(id)` provides seeded pseudo-randomness for abilities that need to make a consistent choice on both clients (e.g., bubbles popping target selection). Use this instead of `Math.random()` anywhere inside `resolveCaptures` or `placeCard`.

**`captureCell()` vs `resolveCaptures()`:** `captureCell()` handles what happens TO a cell being captured (knife immunity, bone immunity, special on-capture effects like candle, egg, balloon, brain). `resolveCaptures()` handles what a newly-placed card does TO its neighbors. New card abilities go in `resolveCaptures`; new capture reactions go in `captureCell`.

**Spin animation:** `drawSpin()` runs for 4800ms before the board appears. `spinAnim.firstPlayer` is snapshotted at `setState()` time and never updated — it cannot be flipped by mid-spin state changes. Mouse input is blocked during spin. `KNIFE_ANGLES.down (π/4)` points the knife tip south (toward "you"), `KNIFE_ANGLES.up (-3π/4)` points it north (toward "opponent") — the going-first player's target is `KNIFE_ANGLES.down`.

**`pendingChanges`:** Deferred effects (zombie conversion, gravestone transform) are stored as `PendingChange[]` on `GameState` and resolved at the start of the affected player's next `placeCard()` call via `resolveAfterActor`. They do not fire automatically.

**Canvas dimensions:** 680×700. Board grid origin is at `this.gridY`. Hand layout uses a circular fan with `FAN_RADIUS = 350`, centered at `MY_HAND_CY = 600` (local) and `OPP_HAND_CY = 100` (opponent).

**Card tooltips (`CARD_LABELS` in `Game.ts`):** Describe only the card's *special ability* — never mention its standard capture directions. The direction indicators on the card face already communicate that visually.

**`KNIFE_ANGLES`:** Defined at the top of `Game.ts` as a `Record<Direction, number>`. All card emoji are rendered using these angles via `ctx.rotate(KNIFE_ANGLES[card.direction])`.
