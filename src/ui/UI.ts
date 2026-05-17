import type { DeckType } from '../game/types';

export class UI {
  private lobby          = document.getElementById('lobby-screen')!;
  private gameScreen     = document.getElementById('game-screen')!;
  private betweenScreen  = document.getElementById('between-screen')!;
  private matchoverScreen = document.getElementById('matchover-screen')!;
  private settingsScreen = document.getElementById('settings-screen')!;
  private foilCreatorScreen = document.getElementById('foil-creator-screen')!;
  private status         = document.getElementById('status')!;

  private allScreens() {
    return [this.lobby, this.gameScreen, this.betweenScreen, this.matchoverScreen, this.settingsScreen, this.foilCreatorScreen];
  }

  private show(screen: HTMLElement) {
    for (const s of this.allScreens()) s.classList.remove('active');
    screen.classList.add('active');
  }

  showLobby()        { this.show(this.lobby); }
  showGame()         { this.show(this.gameScreen); }
  showSettings()     { this.show(this.settingsScreen); }
  showFoilCreator()  { this.show(this.foilCreatorScreen); }

  showBetweenGames(opts: {
    myWins: number;
    oppWins: number;
    lastResult: 'win' | 'loss' | 'draw';
    lockedDeck: DeckType | null;
  }) {
    const scoreEl = document.getElementById('between-score')!;
    const resultEl = document.getElementById('between-result')!;
    const noteEl = document.getElementById('between-deck-note')!;
    const deckSel = document.getElementById('between-deck-select') as HTMLSelectElement;

    scoreEl.textContent = `${opts.myWins} — ${opts.oppWins}`;
    resultEl.textContent = opts.lastResult === 'win' ? 'you won that game'
      : opts.lastResult === 'loss' ? 'you lost that game'
      : 'that game was a draw';

    if (opts.lockedDeck !== null) {
      deckSel.value = opts.lockedDeck;
      deckSel.disabled = true;
      noteEl.textContent = "winners can't switch";
    } else {
      deckSel.disabled = false;
      noteEl.textContent = '';
    }

    document.getElementById('between-status')!.textContent = '';
    const readyBtn = document.getElementById('ready-btn') as HTMLButtonElement;
    readyBtn.disabled = false;
    this.show(this.betweenScreen);
  }

  showMatchOver(opts: { myWins: number; oppWins: number; iWon: boolean }) {
    document.getElementById('matchover-result')!.textContent =
      opts.iWon ? 'sacrifice complete' : 'you have been sacrificed';
    document.getElementById('matchover-score')!.textContent =
      `final score: ${opts.myWins} — ${opts.oppWins}`;
    this.show(this.matchoverScreen);
  }

  getBetweenDeck(): DeckType {
    return (document.getElementById('between-deck-select') as HTMLSelectElement).value as DeckType;
  }

  setBetweenStatus(msg: string) {
    document.getElementById('between-status')!.textContent = msg;
  }

  setStatus(msg: string) {
    this.status.textContent = msg;
  }
}
