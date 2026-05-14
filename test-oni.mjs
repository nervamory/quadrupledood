// Mirrors the oni placement fallback logic from gameLogic.ts
// Run with: node test-oni.mjs

const row = 1, col = 1; // oni always placed at (1,1) for these tests

const preferred = [
  [[row, col - 1], '🫳', 'up'],
  [[row, col + 1], '🫴', 'up'],
];

const fallbackFor = {
  '🫳': [
    [[row - 1, col - 1], 'up-right'],
    [[row + 1, col - 1], 'up-left'],
    [[row - 1, col],     'right'],
    [[row + 1, col],     'left'],
    [[row - 1, col + 1], 'down-right'],
    [[row + 1, col + 1], 'down-left'],
    [[row,     col + 1], 'up'],
  ],
  '🫴': [
    [[row - 1, col + 1], 'up-left'],
    [[row + 1, col + 1], 'up-right'],
    [[row - 1, col],     'left'],
    [[row + 1, col],     'right'],
    [[row - 1, col - 1], 'down-left'],
    [[row + 1, col - 1], 'down-right'],
    [[row,     col - 1], 'up'],
  ],
};

function placeHands(blocked) {
  // blocked = Set of "r,c" strings
  const toPlace = [];
  const remaining = ['🫳', '🫴'];

  for (const [[er, ec], emoji, dir] of preferred) {
    if (toPlace.length >= 2) break;
    if (blocked.has(`${er},${ec}`)) continue;
    toPlace.push({ pos: [er, ec], emoji, dir });
    remaining.splice(remaining.indexOf(emoji), 1);
  }

  for (const emoji of remaining) {
    for (const [[er, ec], dir] of fallbackFor[emoji]) {
      if (er < 0 || er >= 4 || ec < 0 || ec >= 4) continue;
      if (blocked.has(`${er},${ec}`)) continue;
      if (toPlace.some(p => p.pos[0] === er && p.pos[1] === ec)) continue;
      toPlace.push({ pos: [er, ec], emoji, dir });
      break;
    }
  }

  return toPlace;
}

function posName(r, c) {
  const names = {
    '0,0':'UL','0,1':'U','0,2':'UR',
    '1,0':'L', '1,1':'ONI','1,2':'R',
    '2,0':'DL','2,1':'D','2,2':'DR',
  };
  return names[`${r},${c}`] ?? `(${r},${c})`;
}

function run(label, blocked) {
  const result = placeHands(blocked);
  const desc = result.length === 0
    ? 'no hands placed'
    : result.map(p => `${p.emoji}→${posName(...p.pos)}(${p.dir})`).join('  ');
  const blockedNames = [...blocked].map(s => posName(...s.split(',').map(Number))).join(',') || 'none';
  console.log(`${label.padEnd(30)} blocked:[${blockedNames.padEnd(12)}] → ${desc}`);
}

const b = (...coords) => new Set(coords.map(([r,c]) => `${r},${c}`));

console.log('=== Oni at (1,1), 4×4 board ===\n');

run('both preferred free',         b());
run('L blocked',                   b([1,0]));
run('R blocked',                   b([1,2]));
run('L+R blocked',                 b([1,0],[1,2]));
run('L+R+UL blocked',              b([1,0],[1,2],[0,0]));
run('L+R+UL+DL blocked',           b([1,0],[1,2],[0,0],[2,0]));
run('L+R+UL+DL+U blocked',         b([1,0],[1,2],[0,0],[2,0],[0,1]));
run('L+R+UL+DL+U+D blocked',       b([1,0],[1,2],[0,0],[2,0],[0,1],[2,1]));
run('L+R+UL+DL+U+D+UR blocked',    b([1,0],[1,2],[0,0],[2,0],[0,1],[2,1],[0,2]));
run('L+R+UL+DL+U+D+UR+DR blocked', b([1,0],[1,2],[0,0],[2,0],[0,1],[2,1],[0,2],[2,2]));
run('only R free',                  b([1,0],[0,0],[2,0],[0,1],[2,1],[0,2],[2,2]));
run('only L free',                  b([1,2],[0,0],[2,0],[0,1],[2,1],[0,2],[2,2]));
run('only UL free',                 b([1,0],[1,2],[2,0],[0,1],[2,1],[0,2],[2,2]));
run('only DR free',                 b([1,0],[1,2],[0,0],[2,0],[0,1],[2,1],[0,2]));
run('only U free',                  b([1,0],[1,2],[0,0],[2,0],[2,1],[0,2],[2,2]));
