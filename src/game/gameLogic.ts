import type { Card, BoardCell, GameState, Direction, CardType, DeckType, PendingChange } from './types';

const ORTHOGONAL_DIRS: Direction[] = ['up', 'down', 'left', 'right'];

const OFFSETS: Record<Direction, [number, number]> = {
  up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1],
  'up-left': [-1, -1], 'up-right': [-1, 1], 'down-left': [1, -1], 'down-right': [1, 1],
};

const OPPOSITE: Record<Direction, Direction> = {
  up: 'down', down: 'up', left: 'right', right: 'left',
  'up-left': 'down-right', 'up-right': 'down-left', 'down-left': 'up-right', 'down-right': 'up-left',
};

const TOUCHING_DIRS: Direction[] = ['up', 'down', 'left', 'right', 'up-left', 'up-right', 'down-left', 'down-right'];

function randomDirection(): Direction {
  return TOUCHING_DIRS[Math.floor(Math.random() * 8)];
}

// Deterministic hash of a card ID — same result on both clients for the same card.
// Used wherever multiplayer-synced randomness is needed.
function cardHash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

const COMMON: CardType[] = ['knife'];
const RARE:   CardType[] = ['heart', 'eye', 'mirror', 'bandage', 'ghost', 'fog', 'wolf', 'mermaid', 'bubbles', 'bone', 'brain', 'gravestone', 'tooth', 'fire', 'web', 'egg', 'troll', 'alien', 'hellfire', 'snake', 'clown-car', 'balloon', 'lipstick', 'kisses'];
const FOIL:   CardType[] = ['moon', 'vampire', 'squid', 'skull', 'zombie', 'oni', 'spider', 'dragon', 'imp', 'clown', 'succubus'];

function pick(pool: CardType[], n: number): CardType[] {
  return Array.from({ length: n }, () => pool[Math.floor(Math.random() * pool.length)]);
}

function dealHand(actorNr: number, deck: DeckType): Card[] {
  let types: CardType[];
  switch (deck) {
    case 'debug':
      types = ['ghost', 'heart', 'eye', 'mirror', 'bandage', 'fog', 'wolf', 'moon', 'tooth', 'vampire', 'knife', 'squid', 'mermaid', 'bubbles', 'skull', 'bone', 'zombie', 'brain', 'gravestone', 'oni', 'fire', 'imp', 'hellfire', 'snake', 'clown', 'clown-car', 'balloon', 'succubus', 'lipstick', 'kisses'];
      break;
    case 'vampire':
      types = ['vampire', 'heart', 'eye', 'eye', 'knife', ...pick(COMMON, 4)];
      break;
    case 'werewolf':
      types = ['wolf', 'wolf', 'moon', 'fog', 'knife', ...pick(COMMON, 4)];
      break;
    case 'ocean':
      types = ['squid', 'mermaid', 'bubbles', 'bubbles', 'knife', ...pick(COMMON, 4)];
      break;
    case 'bones':
      types = ['skull', 'bone', 'bone', 'tooth', 'knife', ...pick(COMMON, 4)];
      break;
    case 'zombie':
      types = ['zombie', 'brain', 'brain', 'gravestone', 'knife', ...pick(COMMON, 4)];
      break;
    case 'oni':
      types = ['oni', 'eye', 'fire', 'fire', 'knife', ...pick(COMMON, 4)];
      break;
    case 'spider':
      types = ['spider', 'egg', 'web', 'web', 'knife', ...pick(COMMON, 4)];
      break;
    case 'knife':
      types = Array(9).fill('knife') as CardType[];
      break;
    case 'demon':
      types = ['imp', 'hellfire', 'snake', 'snake', 'knife', ...pick(COMMON, 4)];
      break;
    case 'clown':
      types = ['clown', 'clown-car', 'balloon', 'balloon', 'knife', ...pick(COMMON, 4)];
      break;
    case 'succubus':
      types = ['succubus', 'lipstick', 'kisses', 'kisses', 'knife', ...pick(COMMON, 4)];
      break;
    default:
      types = ['knife', ...pick(COMMON, 4), ...pick(RARE, 3), ...pick(FOIL, 1)];
  }

  for (let i = types.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [types[i], types[j]] = [types[j], types[i]];
  }
  const KNIFE_QUADRANTS: Direction[][] = [
    ['up', 'up-right'],
    ['right', 'down-right'],
    ['down', 'down-left'],
    ['left', 'up-left'],
  ];
  let boneIdx = 0;
  let snakeIdx = 0;
  let knifeIdx = 0;
  return types.map((type, i) => {
    let direction: Direction;
    if (type === 'bone') {
      direction = deck === 'bones'
        ? (boneIdx++ % 2 === 0 ? 'up-right' : 'up-left')
        : (Math.random() < 0.5 ? 'up-right' : 'up-left');
    } else if (type === 'snake' && deck === 'demon') {
      direction = snakeIdx++ % 2 === 0 ? 'right' : 'up';
    } else if (type === 'knife') {
      const ki = knifeIdx++;
      if (ki < 4) {
        const q = KNIFE_QUADRANTS[ki];
        direction = q[Math.floor(Math.random() * 2)];
      } else {
        direction = randomDirection();
      }
    } else {
      direction = randomDirection();
    }
    return { id: `${actorNr}-${i}`, direction, type };
  });
}

function isBoneImmune(board: BoardCell[][], row: number, col: number): boolean {
  const cell = board[row][col];
  const isBoneFamily = (t: string) => t === 'bone' || t === 'skull' || t === 'tooth';
  if (!cell || 'blood' in cell || !isBoneFamily(cell.card.type)) return false;
  for (const d of TOUCHING_DIRS) {
    const [dr, dc] = OFFSETS[d];
    const nr = row + dr; const nc = col + dc;
    if (nr < 0 || nr >= 4 || nc < 0 || nc >= 4) continue;
    const adj = board[nr][nc];
    if (adj && !('blood' in adj) && isBoneFamily(adj.card.type) && adj.owner === cell.owner) return true;
  }
  return false;
}

function bubblesPop(board: BoardCell[][], row: number, col: number, attackerNr: number): void {
  const cell = board[row][col];
  if (!cell || 'blood' in cell) return;
  const bubblesOwner = cell.owner;
  board[row][col] = null;
  const targets: [number, number][] = [];
  for (const d of TOUCHING_DIRS) {
    const [dr, dc] = OFFSETS[d];
    const nr = row + dr; const nc = col + dc;
    if (nr < 0 || nr >= 4 || nc < 0 || nc >= 4) continue;
    const adj = board[nr][nc];
    if (adj && 'card' in adj && adj.owner === attackerNr && !isBoneImmune(board, nr, nc))
      targets.push([nr, nc]);
  }
  if (targets.length > 0) {
    const [tr, tc] = targets[cardHash(cell.card.id) % targets.length];
    const t = board[tr][tc];
    if (t && 'card' in t) board[tr][tc] = { card: t.card, owner: bubblesOwner };
  }
}

function captureCell(board: BoardCell[][], row: number, col: number, attackerNr: number): void {
  const cell = board[row][col];
  if (!cell || 'blood' in cell) return;
  if (isBoneImmune(board, row, col)) return;
  if (cell.card.type === 'brain') {
    board[row][col] = { blood: true };
  } else if (cell.card.type === 'bubbles') {
    bubblesPop(board, row, col, attackerNr);
  } else if (cell.card.type === 'balloon') {
    board[row][col] = null;
  } else if (cell.card.type === 'egg') {
    const spider: Card = { id: `hatch-${row}-${col}`, direction: cell.card.direction, type: 'spider' };
    board[row][col] = { card: spider, owner: cell.owner };
    resolveCaptures(board, row, col, cell.owner);
  } else {
    board[row][col] = { card: cell.card, owner: attackerNr };
  }
}

function resolveCaptures(board: BoardCell[][], row: number, col: number, actorNr: number): void {
  const placed = board[row][col];
  if (!placed || 'blood' in placed) return;

  if (placed.card.type === 'heart') {
    // A knife already on the board pointing at this cell kills the heart before it can act.
    for (const dir of TOUCHING_DIRS) {
      const [dr, dc] = OFFSETS[dir];
      const nr = row + dr; const nc = col + dc;
      if (nr < 0 || nr >= 4 || nc < 0 || nc >= 4) continue;
      const neighbor = board[nr][nc];
      if (!neighbor || 'blood' in neighbor || neighbor.owner === actorNr) continue;
      if (neighbor.card.type === 'knife' && neighbor.card.direction === OPPOSITE[dir]) {
        board[row][col] = { blood: true }; // heart walks into a knife — becomes blood
        return;
      }
    }
    // Heart survives — captures all adjacent opponent cards (no stalemate).
    // Heart/eye neighbours become blood instead of being captured.
    for (const dir of ORTHOGONAL_DIRS) {
      const [dr, dc] = OFFSETS[dir];
      const nr = row + dr; const nc = col + dc;
      if (nr < 0 || nr >= 4 || nc < 0 || nc >= 4) continue;
      const neighbor = board[nr][nc];
      if (!neighbor || 'blood' in neighbor || neighbor.owner === actorNr) continue;
      if (neighbor.card.type === 'heart' || neighbor.card.type === 'eye') {
        board[nr][nc] = { blood: true };
        continue;
      }

      if (neighbor.card.type === 'mirror') {
        board[row][col] = { card: placed.card, owner: neighbor.owner }; // reflect heart
        continue;
      }
      captureCell(board, nr, nc, actorNr);
    }
    return;
  }

  if (placed.card.type === 'vampire') {
    // Convert all blood cells to vampires owned by the attacker
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const cell = board[r][c];
        if (cell && 'blood' in cell) {
          const vampCard: Card = { id: `vamp-${r}-${c}`, direction: 'down', type: 'vampire' };
          board[r][c] = { card: vampCard, owner: actorNr };
          resolveCaptures(board, r, c, actorNr);
        }
      }
    }
    // Capture down-diagonal left and right
    for (const [nr, nc] of [[row + 1, col - 1], [row + 1, col + 1]] as [number, number][]) {
      if (nr < 0 || nr >= 4 || nc < 0 || nc >= 4) continue;
      const neighbor = board[nr][nc];
      if (!neighbor || 'blood' in neighbor || neighbor.owner === actorNr) continue;

      if (neighbor.card.type === 'heart' || neighbor.card.type === 'eye') {
        board[nr][nc] = { blood: true };
        continue;
      }
      if (neighbor.card.type === 'mirror') {
        board[row][col] = { card: placed.card, owner: neighbor.owner };
        continue;
      }
      captureCell(board, nr, nc, actorNr);
    }
    return;
  }

  if (placed.card.type === 'bandage') {
    // Captures left and right
    for (const [nr, nc] of [[row, col - 1], [row, col + 1]] as [number, number][]) {
      if (nr < 0 || nr >= 4 || nc < 0 || nc >= 4) continue;
      const neighbor = board[nr][nc];
      if (!neighbor || 'blood' in neighbor || neighbor.owner === actorNr) continue;

      if (neighbor.card.type === 'heart' || neighbor.card.type === 'eye') {
        board[nr][nc] = { blood: true };
        continue;
      }
      if (neighbor.card.type === 'mirror') {
        board[row][col] = { card: placed.card, owner: neighbor.owner };
        continue;
      }
      captureCell(board, nr, nc, actorNr);
    }
    return;
  }

  if (placed.card.type === 'ghost') {
    // Captures the cell directly below
    const [nr, nc] = [row + 1, col];
    if (nr >= 0 && nr < 4 && nc >= 0 && nc < 4) {
      const neighbor = board[nr][nc];
      if (neighbor && !('blood' in neighbor) && neighbor.owner !== actorNr) {
        if (neighbor.card.type === 'heart' || neighbor.card.type === 'eye') {
          board[nr][nc] = { blood: true };
        } else if (neighbor.card.type === 'mirror') {
          board[row][col] = { card: placed.card, owner: neighbor.owner };
        } else {
          captureCell(board, nr, nc, actorNr);
        }
      }
    }
    return;
  }

  if (placed.card.type === 'wolf') {
    const moonIsOut = board.flat().some(c => c && 'card' in c && c.card.type === 'moon');
    const targets: [number, number][] = moonIsOut
      ? [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]]
      : [[row - 1, col - 1], [row - 1, col + 1], [row + 1, col - 1], [row + 1, col + 1]];
    for (const [nr, nc] of targets) {
      if (nr < 0 || nr >= 4 || nc < 0 || nc >= 4) continue;
      const neighbor = board[nr][nc];
      if (!neighbor || 'blood' in neighbor || neighbor.owner === actorNr) continue;

      if (neighbor.card.type === 'heart' || neighbor.card.type === 'eye') {
        board[nr][nc] = { blood: true };
        continue;
      }
      if (neighbor.card.type === 'mirror') {
        board[row][col] = { card: placed.card, owner: neighbor.owner };
        continue;
      }
      captureCell(board, nr, nc, actorNr);
    }
    return;
  }

  if (placed.card.type === 'squid') {
    // Pop all bubbles on the board — capture everything adjacent to each popped bubble
    const bubblesPos: [number, number][] = [];
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) {
        const cell = board[r][c];
        if (cell && 'card' in cell && cell.card.type === 'bubbles') bubblesPos.push([r, c]);
      }
    for (const [br, bc] of bubblesPos) {
      board[br][bc] = null;
      for (const dir of TOUCHING_DIRS) {
        const [dr, dc] = OFFSETS[dir];
        const nr = br + dr, nc = bc + dc;
        if (nr < 0 || nr >= 4 || nc < 0 || nc >= 4) continue;
        const neighbor = board[nr][nc];
        if (!neighbor || 'blood' in neighbor || neighbor.owner === actorNr) continue;
        if (neighbor.card.type === 'heart' || neighbor.card.type === 'eye') { board[nr][nc] = { blood: true }; continue; }
        if (neighbor.card.type === 'mirror') { board[row][col] = { card: placed.card, owner: neighbor.owner }; continue; }
        captureCell(board, nr, nc, actorNr);
      }
    }
    // Capture left, right, down-left, down-right
    for (const [nr, nc] of [[row, col - 1], [row, col + 1], [row + 1, col - 1], [row + 1, col + 1]] as [number, number][]) {
      if (nr < 0 || nr >= 4 || nc < 0 || nc >= 4) continue;
      const neighbor = board[nr][nc];
      if (!neighbor || 'blood' in neighbor || neighbor.owner === actorNr) continue;
      if (neighbor.card.type === 'heart' || neighbor.card.type === 'eye') { board[nr][nc] = { blood: true }; continue; }
      if (neighbor.card.type === 'mirror') { board[row][col] = { card: placed.card, owner: neighbor.owner }; continue; }
      captureCell(board, nr, nc, actorNr);
    }
    return;
  }

  if (placed.card.type === 'mermaid') {
    // Capture left, up-left, up
    for (const [nr, nc] of [[row, col - 1], [row - 1, col - 1], [row - 1, col]] as [number, number][]) {
      if (nr < 0 || nr >= 4 || nc < 0 || nc >= 4) continue;
      const neighbor = board[nr][nc];
      if (!neighbor || 'blood' in neighbor || neighbor.owner === actorNr) continue;

      if (neighbor.card.type === 'heart' || neighbor.card.type === 'eye') { board[nr][nc] = { blood: true }; continue; }
      if (neighbor.card.type === 'mirror') { board[row][col] = { card: placed.card, owner: neighbor.owner }; continue; }
      captureCell(board, nr, nc, actorNr);
    }
    return;
  }

  if (placed.card.type === 'fog') {
    // Visibility is computed dynamically in Game.ts (isFoggedFor) — no board mutation needed.
    return;
  }

  if (placed.card.type === 'zombie') {
    // Zombify all adjacent opponent cards (all 8 directions) — becomes grey, counts for neither player
    for (const dir of TOUCHING_DIRS) {
      const [dr, dc] = OFFSETS[dir];
      const nr = row + dr; const nc = col + dc;
      if (nr < 0 || nr >= 4 || nc < 0 || nc >= 4) continue;
      const neighbor = board[nr][nc];
      if (!neighbor || 'blood' in neighbor || neighbor.owner === actorNr) continue;
      if (isBoneImmune(board, nr, nc)) continue;
      if (neighbor.card.type === 'mirror') {
        board[row][col] = { card: placed.card, owner: neighbor.owner };
        continue;
      }
      board[nr][nc] = { card: neighbor.card, owner: actorNr, zombified: true };
    }
    return;
  }

  if (placed.card.type === 'brain') {
    // Captures left, right, down
    for (const [nr, nc] of [[row, col - 1], [row, col + 1], [row + 1, col]] as [number, number][]) {
      if (nr < 0 || nr >= 4 || nc < 0 || nc >= 4) continue;
      const neighbor = board[nr][nc];
      if (!neighbor || 'blood' in neighbor || neighbor.owner === actorNr) continue;

      if (neighbor.card.type === 'heart' || neighbor.card.type === 'eye') { board[nr][nc] = { blood: true }; continue; }
      if (neighbor.card.type === 'mirror') { board[row][col] = { card: placed.card, owner: neighbor.owner }; continue; }
      captureCell(board, nr, nc, actorNr);
    }
    return;
  }

  if (placed.card.type === 'skull') {
    // Captures left, right, up
    for (const [nr, nc] of [[row, col - 1], [row, col + 1], [row - 1, col]] as [number, number][]) {
      if (nr < 0 || nr >= 4 || nc < 0 || nc >= 4) continue;
      const neighbor = board[nr][nc];
      if (!neighbor || 'blood' in neighbor || neighbor.owner === actorNr) continue;

      if (neighbor.card.type === 'heart' || neighbor.card.type === 'eye') { board[nr][nc] = { blood: true }; continue; }
      if (neighbor.card.type === 'mirror') { board[row][col] = { card: placed.card, owner: neighbor.owner }; continue; }
      captureCell(board, nr, nc, actorNr);
    }
    return;
  }

  if (placed.card.type === 'bone') {
    // Captures both corners along its diagonal axis
    const targets: [number, number][] = placed.card.direction === 'up-right'
      ? [[row - 1, col + 1], [row + 1, col - 1]]
      : [[row - 1, col - 1], [row + 1, col + 1]];
    for (const [nr, nc] of targets) {
      if (nr < 0 || nr >= 4 || nc < 0 || nc >= 4) continue;
      const neighbor = board[nr][nc];
      if (!neighbor || 'blood' in neighbor || neighbor.owner === actorNr) continue;

      if (neighbor.card.type === 'heart' || neighbor.card.type === 'eye') { board[nr][nc] = { blood: true }; continue; }
      if (neighbor.card.type === 'mirror') { board[row][col] = { card: placed.card, owner: neighbor.owner }; continue; }
      captureCell(board, nr, nc, actorNr);
    }
    return;
  }

  if (placed.card.type === 'spider') {
    for (const dir of TOUCHING_DIRS) {
      const [dr, dc] = OFFSETS[dir];
      const nr = row + dr; const nc = col + dc;
      if (nr < 0 || nr >= 4 || nc < 0 || nc >= 4) continue;
      const neighbor = board[nr][nc];
      if (!neighbor || 'blood' in neighbor || neighbor.owner === actorNr) continue;
      if (neighbor.card.type === 'heart' || neighbor.card.type === 'eye') { board[nr][nc] = { blood: true }; continue; }
      if (neighbor.card.type === 'mirror') { board[row][col] = { card: placed.card, owner: neighbor.owner }; continue; }
      captureCell(board, nr, nc, actorNr);
    }
    return;
  }

  if (placed.card.type === 'fire') {
    // Wildfire: transforms the card in the pointing direction into fire (bypasses all capture blocks).
    // The new fire resolves its own captures, chaining until it hits empty, blood, a friendly, or the edge.
    const [dr, dc] = OFFSETS[placed.card.direction];
    const nr = row + dr, nc = col + dc;
    if (nr >= 0 && nr < 4 && nc >= 0 && nc < 4) {
      const neighbor = board[nr][nc];
      if (neighbor && !('blood' in neighbor) && neighbor.owner !== actorNr) {
        const spreadFire: Card = { id: `fire-${nr}-${nc}-${placed.card.id}`, direction: placed.card.direction, type: 'fire' };
        board[nr][nc] = { card: spreadFire, owner: actorNr };
        resolveCaptures(board, nr, nc, actorNr);
      }
    }
    return;
  }

  if (placed.card.type === 'hand') {
    // Captures one cell in its pointing direction (like knife, no stalemate)
    const hDir = placed.card.direction;
    const [dr, dc] = OFFSETS[hDir];
    const nr = row + dr; const nc = col + dc;
    if (nr >= 0 && nr < 4 && nc >= 0 && nc < 4) {
      const neighbor = board[nr][nc];
      if (neighbor && !('blood' in neighbor) && neighbor.owner !== actorNr) {
        if (neighbor.card.type === 'heart' || neighbor.card.type === 'eye') {
          board[nr][nc] = { blood: true };
        } else if (neighbor.card.type === 'mirror') {
          board[row][col] = { card: placed.card, owner: neighbor.owner };
        } else {
          captureCell(board, nr, nc, actorNr);
        }
      }
    }
    return;
  }

  if (placed.card.type === 'troll') {
    for (const [nr, nc] of [[row-1,col],[row+1,col],[row,col-1],[row,col+1]] as [number,number][]) {
      if (nr < 0 || nr >= 4 || nc < 0 || nc >= 4) continue;
      const neighbor = board[nr][nc];
      if (!neighbor || 'blood' in neighbor || neighbor.owner === actorNr) continue;
      if (neighbor.card.type === 'heart' || neighbor.card.type === 'eye') { board[nr][nc] = { blood: true }; continue; }
      if (neighbor.card.type === 'mirror') { board[row][col] = { card: placed.card, owner: neighbor.owner }; continue; }
      captureCell(board, nr, nc, actorNr);
    }
    return;
  }

  if (placed.card.type === 'dragon') {
    // Piercing line capture in direction — burns through mirrors
    const [dr, dc] = OFFSETS[placed.card.direction];
    let nr = row + dr, nc = col + dc;
    while (nr >= 0 && nr < 4 && nc >= 0 && nc < 4) {
      const neighbor = board[nr][nc];
      if (neighbor && !('blood' in neighbor) && neighbor.owner !== actorNr) {
        if (neighbor.card.type === 'heart' || neighbor.card.type === 'eye') {
          board[nr][nc] = { blood: true };
        } else {
          captureCell(board, nr, nc, actorNr);
        }
      }
      nr += dr; nc += dc;
    }
    return;
  }

  if (placed.card.type === 'alien') {
    // Knight-move captures: all (±1,±2) and (±2,±1) positions
    for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]] as [number,number][]) {
      const nr = row + dr, nc = col + dc;
      if (nr < 0 || nr >= 4 || nc < 0 || nc >= 4) continue;
      const neighbor = board[nr][nc];
      if (!neighbor || 'blood' in neighbor || neighbor.owner === actorNr) continue;
      if (neighbor.card.type === 'heart' || neighbor.card.type === 'eye') { board[nr][nc] = { blood: true }; continue; }
      if (neighbor.card.type === 'mirror') { board[row][col] = { card: placed.card, owner: neighbor.owner }; continue; }
      captureCell(board, nr, nc, actorNr);
    }
    return;
  }

  if (placed.card.type === 'imp') {
    // Reaches the adjacent up-left and up-right diagonals.
    // Hitting an opponent card: capture normally. Hitting an owned card: retrigger its capture.
    for (const [nr, nc] of [[row - 1, col - 1], [row - 1, col + 1]] as [number, number][]) {
      if (nr < 0 || nr >= 4 || nc < 0 || nc >= 4) continue;
      const neighbor = board[nr][nc];
      if (!neighbor || 'blood' in neighbor) continue;
      if (neighbor.owner === actorNr) {
        resolveCaptures(board, nr, nc, actorNr);
      } else {
        if (neighbor.card.type === 'heart' || neighbor.card.type === 'eye') { board[nr][nc] = { blood: true }; continue; }
        if (neighbor.card.type === 'mirror') { board[row][col] = { card: placed.card, owner: neighbor.owner }; continue; }
        captureCell(board, nr, nc, actorNr);
      }
    }
    return;
  }

  if (placed.card.type === 'hellfire') {
    // Destroys all 8 adjacent cells (friend and foe), then self-destructs.
    for (const dir of TOUCHING_DIRS) {
      const [dr, dc] = OFFSETS[dir];
      const nr = row + dr, nc = col + dc;
      if (nr < 0 || nr >= 4 || nc < 0 || nc >= 4) continue;
      board[nr][nc] = null;
    }
    board[row][col] = null;
    return;
  }

  if (placed.card.type === 'snake') {
    // Bidirectional line capture — sweeps both along direction and its opposite.
    for (const captureDir of [placed.card.direction, OPPOSITE[placed.card.direction]]) {
      const [dr, dc] = OFFSETS[captureDir];
      let nr = row + dr, nc = col + dc;
      while (nr >= 0 && nr < 4 && nc >= 0 && nc < 4) {
        const neighbor = board[nr][nc];
        if (neighbor && !('blood' in neighbor) && neighbor.owner !== actorNr) {
          if (neighbor.card.type === 'heart' || neighbor.card.type === 'eye') {
            board[nr][nc] = { blood: true };
          } else if (neighbor.card.type === 'mirror') {
            board[row][col] = { card: placed.card, owner: neighbor.owner };
            break;
          } else {
            captureCell(board, nr, nc, actorNr);
          }
        }
        nr += dr; nc += dc;
      }
    }
    return;
  }

  if (placed.card.type === 'clown') {
    // Captures up and down; then retriggers any adjacent owned clowns (with loop guard)
    const captureClown = (board: BoardCell[][], r: number, c: number, owner: number, visited: Set<string>) => {
      for (const [nr, nc] of [[r - 1, c], [r + 1, c]] as [number, number][]) {
        if (nr < 0 || nr >= 4 || nc < 0 || nc >= 4) continue;
        const neighbor = board[nr][nc];
        if (!neighbor || 'blood' in neighbor || neighbor.owner === owner) continue;
        if (neighbor.card.type === 'heart' || neighbor.card.type === 'eye') { board[nr][nc] = { blood: true }; continue; }
        if (neighbor.card.type === 'mirror') { board[r][c] = { card: (board[r][c] as { card: Card; owner: number }).card, owner: neighbor.owner }; continue; }
        captureCell(board, nr, nc, owner);
      }
      for (const dir of TOUCHING_DIRS) {
        const [dr, dc] = OFFSETS[dir];
        const ar = r + dr; const ac = c + dc;
        if (ar < 0 || ar >= 4 || ac < 0 || ac >= 4) continue;
        const adj = board[ar][ac];
        if (!adj || 'blood' in adj || adj.owner !== owner || adj.card.type !== 'clown') continue;
        const key = `${ar},${ac}`;
        if (visited.has(key)) continue;
        visited.add(key);
        captureClown(board, ar, ac, owner, visited);
      }
    };
    const visited = new Set([`${row},${col}`]);
    captureClown(board, row, col, actorNr, visited);
    return;
  }

  if (placed.card.type === 'balloon') {
    // Captures one cell directly below
    const [nr, nc] = [row + 1, col];
    if (nr >= 0 && nr < 4 && nc >= 0 && nc < 4) {
      const neighbor = board[nr][nc];
      if (neighbor && !('blood' in neighbor) && neighbor.owner !== actorNr) {
        if (neighbor.card.type === 'heart' || neighbor.card.type === 'eye') {
          board[nr][nc] = { blood: true };
        } else if (neighbor.card.type === 'mirror') {
          board[row][col] = { card: placed.card, owner: neighbor.owner };
        } else {
          captureCell(board, nr, nc, actorNr);
        }
      }
    }
    return;
  }

  // Passive cards — no captures on placement
  if (placed.card.type === 'eye' || placed.card.type === 'tooth' || placed.card.type === 'moon' || placed.card.type === 'mirror' || placed.card.type === 'bubbles' || placed.card.type === 'gravestone' || placed.card.type === 'oni' || placed.card.type === 'egg' || placed.card.type === 'web' || placed.card.type === 'clown-car') return;

  if (placed.card.type === 'succubus') {
    // Pull: for each cardinal direction, if 2 squares out has an opponent card and 1 square out is empty, slide it closer
    for (const dir of ORTHOGONAL_DIRS) {
      const [dr, dc] = OFFSETS[dir];
      const r1 = row + dr,  c1 = col + dc;
      const r2 = row + 2*dr, c2 = col + 2*dc;
      if (r2 < 0 || r2 >= 4 || c2 < 0 || c2 >= 4) continue;
      if (r1 < 0 || r1 >= 4 || c1 < 0 || c1 >= 4) continue;
      const far = board[r2][c2];
      if (!far || 'blood' in far || far.owner === actorNr) continue;
      if (board[r1][c1] !== null) continue;
      board[r1][c1] = far;
      board[r2][c2] = null;
    }
    // Capture: all 4 adjacent cardinal cells
    for (const dir of ORTHOGONAL_DIRS) {
      const [dr, dc] = OFFSETS[dir];
      const nr = row + dr; const nc = col + dc;
      if (nr < 0 || nr >= 4 || nc < 0 || nc >= 4) continue;
      const neighbor = board[nr][nc];
      if (!neighbor || 'blood' in neighbor || neighbor.owner === actorNr) continue;
      if (neighbor.card.type === 'heart' || neighbor.card.type === 'eye') { board[nr][nc] = { blood: true }; continue; }
      if (neighbor.card.type === 'mirror') { board[row][col] = { card: placed.card, owner: neighbor.owner }; continue; }
      captureCell(board, nr, nc, actorNr);
    }
    return;
  }

  if (placed.card.type === 'kisses') {
    // Captures exactly one random adjacent opponent card (all 8 directions)
    const targets: [number, number][] = [];
    for (const dir of TOUCHING_DIRS) {
      const [dr, dc] = OFFSETS[dir];
      const nr = row + dr, nc = col + dc;
      if (nr < 0 || nr >= 4 || nc < 0 || nc >= 4) continue;
      const neighbor = board[nr][nc];
      if (!neighbor || 'blood' in neighbor || neighbor.owner === actorNr) continue;
      targets.push([nr, nc]);
    }
    if (targets.length > 0) {
      const [nr, nc] = targets[cardHash(placed.card.id) % targets.length];
      const neighbor = board[nr][nc];
      if (neighbor && !('blood' in neighbor)) {
        if (neighbor.card.type === 'heart' || neighbor.card.type === 'eye') {
          board[nr][nc] = { blood: true };
        } else if (neighbor.card.type === 'mirror') {
          board[row][col] = { card: placed.card, owner: neighbor.owner };
        } else {
          captureCell(board, nr, nc, actorNr);
        }
      }
    }
    return;
  }

  if (placed.card.type === 'lipstick') {
    // No direct capture — recaptures adjacent kisses cards and retriggers them
    for (const dir of TOUCHING_DIRS) {
      const [dr, dc] = OFFSETS[dir];
      const nr = row + dr, nc = col + dc;
      if (nr < 0 || nr >= 4 || nc < 0 || nc >= 4) continue;
      const neighbor = board[nr][nc];
      if (!neighbor || 'blood' in neighbor || neighbor.card.type !== 'kisses' || neighbor.owner !== actorNr) continue;
      resolveCaptures(board, nr, nc, actorNr);
    }
    return;
  }

  // Knife: captures in the single direction it's pointing (cardinal or diagonal)
  const kDir = placed.card.direction;
  const [dr, dc] = OFFSETS[kDir];
  const nr = row + dr; const nc = col + dc;
  if (nr >= 0 && nr < 4 && nc >= 0 && nc < 4) {
    const neighbor = board[nr][nc];
    if (neighbor && !('blood' in neighbor) && neighbor.owner !== actorNr) {
      if (neighbor.card.type === 'heart' || neighbor.card.type === 'eye') {
        board[nr][nc] = { blood: true };
      } else if (neighbor.card.type === 'mirror') {
        board[row][col] = { card: placed.card, owner: neighbor.owner };
      } else if (neighbor.card.direction === OPPOSITE[kDir]) {
        // knife cannot capture any card facing it
      } else {
        captureCell(board, nr, nc, actorNr);
      }
    }
  }
}

function canPlay(board: BoardCell[][], hand: Card[]): boolean {
  if (hand.length === 0) return false;
  const cells = board.flat();
  const hasEmpty = cells.some(c => c === null);
  const hasBlood = cells.some(c => c !== null && 'blood' in c);
  const hasCard  = cells.some(c => c !== null && !('blood' in c));
  return hand.some(card => {
    if (card.type === 'bandage') return hasBlood;
    if (card.type === 'web')     return hasCard;
    return hasEmpty;
  });
}

export function initGame(actor1: number, actor2: number, deck1: DeckType = 'random', deck2: DeckType = 'random'): GameState {
  const board: BoardCell[][] = Array.from({ length: 4 }, () => Array<BoardCell>(4).fill(null));
  return {
    board,
    hands: {
      [actor1]: dealHand(actor1, deck1),
      [actor2]: dealHand(actor2, deck2),
    },
    currentTurn: Math.random() < 0.5 ? actor1 : actor2,
    phase: 'playing',
    winner: null,
    blackPlayer: actor1,
    pendingChanges: [],
  };
}

export function placeCard(
  state: GameState,
  actorNr: number,
  cardId: string,
  row: number,
  col: number,
): GameState {
  if (state.phase !== 'playing') return state;
  if (state.currentTurn !== actorNr) return state;
  if (row < 0 || row > 3 || col < 0 || col > 3) return state;

  const hand = state.hands[actorNr] ?? [];
  const cardIdx = hand.findIndex(c => c.id === cardId);
  if (cardIdx === -1) return state;

  const card = hand[cardIdx];
  const targetCell = state.board[row][col];
  const isBlood = targetCell !== null && 'blood' in targetCell;
  const isCard = targetCell !== null && !isBlood;
  if (targetCell !== null && !(card.type === 'bandage' && isBlood) && !(card.type === 'web' && isCard)) return state;
  const newBoard: BoardCell[][] = state.board.map(r => [...r]);
  newBoard[row][col] = { card, owner: actorNr };

  let newHands: Record<number, Card[]> = {
    ...state.hands,
    [actorNr]: hand.filter((_, i) => i !== cardIdx),
  };

  resolveCaptures(newBoard, row, col, actorNr);

  const playerNrs = Object.keys(state.hands).map(Number);
  const otherPlayer = playerNrs.find(n => n !== actorNr)!;

  if (card.type === 'oni') {
    const preferred: [[number, number], '🫳' | '🫴', Direction, number][] = [
      [[row, col - 1], '🫳', 'up', -Math.PI / 2],
      [[row, col + 1], '🫴', 'up', -Math.PI / 2],
    ];
    const fallbackFor: Record<'🫳' | '🫴', [[number, number], Direction, number][]> = {
      '🫳': [
        [[row - 1, col - 1], 'up-right',   -Math.PI / 4],
        [[row + 1, col - 1], 'up-left',    -3 * Math.PI / 4],
        [[row - 1, col],     'right',       0],
        [[row + 1, col],     'left',        Math.PI],
        [[row - 1, col + 1], 'down-right',  Math.PI / 4],
        [[row + 1, col + 1], 'down-left',   3 * Math.PI / 4],
        [[row,     col + 1], 'up',         -Math.PI / 2],
      ],
      '🫴': [
        [[row - 1, col + 1], 'up-left',    -3 * Math.PI / 4],
        [[row + 1, col + 1], 'up-right',   -Math.PI / 4],
        [[row - 1, col],     'left',        Math.PI],
        [[row + 1, col],     'right',       0],
        [[row - 1, col - 1], 'down-left',   3 * Math.PI / 4],
        [[row + 1, col - 1], 'down-right',  Math.PI / 4],
        [[row,     col - 1], 'up',         -Math.PI / 2],
      ],
    };
    const toPlace: [number, number, Direction, '🫳' | '🫴', number][] = [];
    const remaining = new Set<'🫳' | '🫴'>(['🫳', '🫴']);

    for (const [[er, ec], emoji, dir, angle] of preferred) {
      if (toPlace.length >= 2) break;
      if (er < 0 || er >= 4 || ec < 0 || ec >= 4 || newBoard[er][ec]) continue;
      toPlace.push([er, ec, dir, emoji, angle]);
      remaining.delete(emoji);
    }
    for (const emoji of [...remaining] as ('🫳' | '🫴')[]) {
      for (const [[er, ec], dir, angle] of fallbackFor[emoji]) {
        if (er < 0 || er >= 4 || ec < 0 || ec >= 4 || newBoard[er][ec]) continue;
        if (toPlace.some(([pr, pc]) => pr === er && pc === ec)) continue;
        toPlace.push([er, ec, dir, emoji, angle]);
        break;
      }
    }
    for (const [er, ec, handDir, emoji, angle] of toPlace) {
      const summonCard: Card = {
        id: `oni-${er}-${ec}-${actorNr}`,
        direction: handDir,
        type: 'hand',
        summonedHand: { emoji, angle },
      };
      newBoard[er][ec] = { card: summonCard, owner: actorNr };
      resolveCaptures(newBoard, er, ec, actorNr);
    }
  }

  // Moon: flip ownership of every card on the board (including the moon itself)
  if (card.type === 'moon') {
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const cell = newBoard[r][c];
        // Skip moon itself and zombified cells (zombified ownership is tracked by pending changes)
        if (cell && 'card' in cell && cell.card.type !== 'moon' && !cell.zombified) {
          newBoard[r][c] = { ...cell, owner: cell.owner === actorNr ? otherPlayer : actorNr };
        }
      }
    }
  }

  // Ghost: swap a random card between hands after capturing
  if (card.type === 'ghost') {
    const myCards = newHands[actorNr];
    const oppCards = newHands[otherPlayer];
    if (myCards.length > 0 && oppCards.length > 0) {
      const h = cardHash(card.id);
      const myIdx  = h % myCards.length;
      const oppIdx = (h >>> 8) % oppCards.length;
      const myCard  = myCards[myIdx];
      const oppCard = oppCards[oppIdx];
      newHands = {
        ...newHands,
        [actorNr]:    myCards.map((c, i)  => i === myIdx  ? oppCard : c),
        [otherPlayer]: oppCards.map((c, i) => i === oppIdx ? myCard  : c),
      };
    }
  }

  // Mermaid: pull a random opponent hand card onto a random empty board cell
  if (card.type === 'mermaid') {
    const oppCards = newHands[otherPlayer];
    if (oppCards.length > 0) {
      const emptyCells: [number, number][] = [];
      for (let r = 0; r < 4; r++)
        for (let c = 0; c < 4; c++)
          if (!newBoard[r][c]) emptyCells.push([r, c]);
      if (emptyCells.length > 0) {
        const h = cardHash(card.id);
        const pullIdx = h % oppCards.length;
        const [er, ec] = emptyCells[(h >>> 8) % emptyCells.length];
        newBoard[er][ec] = { card: oppCards[pullIdx], owner: actorNr };
        newHands = { ...newHands, [otherPlayer]: oppCards.filter((_, i) => i !== pullIdx) };
      }
    }
  }

  // Clown-car: spawn 1 clown at the START of the owner's turn (= after opponent places)
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const ccCell = newBoard[r][c];
      if (!ccCell || !('card' in ccCell) || ccCell.card.type !== 'clown-car' || ccCell.owner !== otherPlayer) continue;
      const empty: [number, number][] = [];
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]] as [number,number][]) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < 4 && nc >= 0 && nc < 4 && !newBoard[nr][nc]) empty.push([nr, nc]);
      }
      if (empty.length === 0) continue;
      const h = cardHash(ccCell.card.id + card.id);
      const [er, ec] = empty[h % empty.length];
      const dirs: Direction[] = ['up', 'down', 'left', 'right'];
      const clownCard: Card = { id: `cc-clown-${r}-${c}-${card.id}`, direction: dirs[h % 4], type: 'clown' };
      newBoard[er][ec] = { card: clownCard, owner: actorNr };
      resolveCaptures(newBoard, er, ec, actorNr);
    }
  }

  // Pending changes: split existing into "resolves this turn" vs "keep"
  const toResolve = state.pendingChanges.filter(p => p.resolveAfterActor === actorNr);
  let newPending: PendingChange[] = state.pendingChanges.filter(p => p.resolveAfterActor !== actorNr);

  // Schedule new deferred effects from this card
  if (card.type === 'zombie') {
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      const cell = newBoard[r][c];
      if (cell && 'card' in cell && cell.zombified && cell.owner === actorNr)
        newPending.push({ type: 'zombie-convert', row: r, col: c, owner: actorNr, resolveAfterActor: otherPlayer });
    }
  }
  if (card.type === 'gravestone') {
    newPending.push({ type: 'gravestone-transform', row, col, owner: actorNr, resolveAfterActor: otherPlayer });
  }

  // Resolve effects that were deferred until this actor's turn
  for (const change of toResolve) {
    if (change.type === 'zombie-convert') {
      const cell = newBoard[change.row][change.col];
      if (cell && 'card' in cell && cell.zombified && cell.owner === change.owner)
        newBoard[change.row][change.col] = { card: cell.card, owner: change.owner };
    } else if (change.type === 'gravestone-transform') {
      const cell = newBoard[change.row][change.col];
      if (cell && 'card' in cell && cell.card.type === 'gravestone' && cell.owner === change.owner) {
        const zombieCard: Card = { id: `gz-${change.row}-${change.col}`, direction: 'up', type: 'zombie' };
        newBoard[change.row][change.col] = { card: zombieCard, owner: change.owner };
        resolveCaptures(newBoard, change.row, change.col, change.owner);
      }
    }
  }

  // Pick up any newly zombified cells (e.g. from a just-spawned gravestone-zombie) not yet scheduled
  const scheduledConverts = new Set(newPending.filter(p => p.type === 'zombie-convert').map(p => `${p.row},${p.col}`));
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    const cell = newBoard[r][c];
    if (cell && 'card' in cell && cell.zombified && !scheduledConverts.has(`${r},${c}`))
      newPending.push({ type: 'zombie-convert', row: r, col: c, owner: cell.owner, resolveAfterActor: otherPlayer });
  }

  const filled = newBoard.flat().filter(Boolean).length;
  const otherCanPlay = canPlay(newBoard, newHands[otherPlayer] ?? []);
  const meCanPlay    = canPlay(newBoard, newHands[actorNr]    ?? []);

  if (filled === 16 || (!otherCanPlay && !meCanPlay)) {
    const counts = playerNrs.reduce<Record<number, number>>((acc, nr) => {
      acc[nr] = newBoard.flat().filter(c => c && 'card' in c && c.owner === nr && !c.zombified).length;
      return acc;
    }, {});
    const [p1, p2] = playerNrs;
    const winner = counts[p1] > counts[p2] ? p1 : counts[p2] > counts[p1] ? p2 : null;
    return { ...state, board: newBoard, hands: newHands, pendingChanges: newPending, phase: 'finished', winner, currentTurn: -1 };
  }

  // Skip otherPlayer's turn if they have no playable moves
  const nextTurn = otherCanPlay ? otherPlayer : actorNr;
  return { ...state, board: newBoard, hands: newHands, pendingChanges: newPending, currentTurn: nextTurn };
}
