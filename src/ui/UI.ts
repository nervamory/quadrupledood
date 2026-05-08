export class UI {
  private lobby = document.getElementById('lobby-screen')!;
  private gameScreen = document.getElementById('game-screen')!;
  private status = document.getElementById('status')!;

  showLobby() {
    this.lobby.classList.add('active');
    this.gameScreen.classList.remove('active');
  }

  showGame() {
    this.lobby.classList.remove('active');
    this.gameScreen.classList.add('active');
  }

  setStatus(msg: string) {
    this.status.textContent = msg;
  }
}
