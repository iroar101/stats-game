import { GameState } from './state';

type UIHandlers = {
  onPlay: () => void;
  onCashOut: () => void;
  onToggleMute: () => void;
  onUserGesture: () => void;
};

export class UI {
  private state: GameState = GameState.IDLE;
  private bannerTimer: number | null = null;
  private tooltipTimer: number | null = null;
  private returnAnimationId: number | null = null;
  private megaWinTimer: number | null = null;
  private returnValue = 0;
  private muted = false;

  private readonly rootEl: HTMLElement;
  private readonly multiplierEl: HTMLElement;
  private readonly potentialEl: HTMLElement;
  private readonly balanceEl: HTMLElement;
  private readonly lastResultEl: HTMLElement;
  private readonly historyRailEl: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly fuelChargeEl: HTMLElement;
  private readonly bannerEl: HTMLElement;
  private readonly megaWinEl: HTMLElement;
  private readonly megaWinTitleEl: HTMLElement;
  private readonly megaWinSubtitleEl: HTMLElement;
  private readonly tooltipEl: HTMLElement;
  private readonly howToggle: HTMLButtonElement;
  private readonly howPanel: HTMLElement;

  constructor(private handlers: UIHandlers) {
    this.rootEl = this.requireEl('ui');
    this.multiplierEl = this.requireEl('multiplier');
    this.potentialEl = this.requireEl('potential');
    this.balanceEl = this.requireEl('balance');
    this.lastResultEl = this.requireEl('lastResult');
    this.historyRailEl = this.requireEl('historyRail');
    this.playBtn = this.requireEl('playBtn') as HTMLButtonElement;
    this.muteBtn = this.requireEl('muteBtn') as HTMLButtonElement;
    this.fuelChargeEl = this.requireEl('fuelCharge');
    this.bannerEl = this.requireEl('banner');
    this.megaWinEl = this.requireEl('megaWin');
    this.megaWinTitleEl = this.requireEl('megaWinTitle');
    this.megaWinSubtitleEl = this.requireEl('megaWinSubtitle');
    this.tooltipEl = this.requireEl('tooltip');
    this.howToggle = this.requireEl('howToggle') as HTMLButtonElement;
    this.howPanel = this.requireEl('howPanel');

    this.playBtn.addEventListener('pointerdown', () => this.handlers.onUserGesture());
    this.playBtn.addEventListener('click', () => {
      if (this.state === GameState.RUNNING) {
        this.handlers.onCashOut();
      } else if (this.state === GameState.IDLE) {
        this.handlers.onPlay();
      }
    });

    this.muteBtn.addEventListener('pointerdown', () => this.handlers.onUserGesture());
    this.muteBtn.addEventListener('click', () => this.handlers.onToggleMute());

    this.howToggle.addEventListener('click', () => {
      this.howPanel.classList.toggle('hidden');
    });
  }

  setState(state: GameState) {
    this.state = state;
    this.rootEl.classList.toggle('running', state === GameState.RUNNING);
    this.rootEl.classList.toggle('charging', state === GameState.FETCHING_RNG);
    this.setFuelCharging(state === GameState.FETCHING_RNG);

    if (state === GameState.RUNNING) {
      this.playBtn.textContent = 'Cash Out';
      this.playBtn.classList.add('running');
      this.playBtn.disabled = false;
      return;
    }

    if (state === GameState.FETCHING_RNG) {
      this.playBtn.textContent = 'Fueling...';
      this.playBtn.disabled = true;
      this.playBtn.classList.remove('running');
      return;
    }

    if (state === GameState.CASHED_OUT || state === GameState.CRASHED) {
      this.playBtn.textContent = 'Resetting...';
      this.playBtn.disabled = true;
      this.playBtn.classList.remove('running');
      return;
    }

    this.playBtn.textContent = 'Launch';
    this.playBtn.disabled = false;
    this.playBtn.classList.remove('running');
  }

  setMultiplier(value: number) {
    this.multiplierEl.textContent = `${value.toFixed(2)}x`;
    this.multiplierEl.classList.remove('calm', 'green', 'gold', 'hot');

    if (value < 2) {
      this.multiplierEl.classList.add('calm');
    } else if (value < 5) {
      this.multiplierEl.classList.add('green');
    } else if (value < 10) {
      this.multiplierEl.classList.add('gold');
    } else {
      this.multiplierEl.classList.add('hot');
    }
  }

  setPotential(payout: number) {
    if (this.returnAnimationId) {
      window.cancelAnimationFrame(this.returnAnimationId);
      this.returnAnimationId = null;
    }
    this.returnValue = payout;
    this.potentialEl.textContent = payout.toFixed(2);
  }

  animateReturn(from: number, to: number, durationMs: number) {
    if (this.returnAnimationId) {
      window.cancelAnimationFrame(this.returnAnimationId);
    }
    const start = performance.now();
    const delta = to - from;
    const animate = (time: number) => {
      const t = Math.min(1, (time - start) / durationMs);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const value = from + delta * eased;
      this.returnValue = value;
      this.potentialEl.textContent = value.toFixed(2);
      if (t < 1) {
        this.returnAnimationId = window.requestAnimationFrame(animate);
      } else {
        this.returnAnimationId = null;
        this.returnValue = to;
        this.potentialEl.textContent = to.toFixed(2);
      }
    };
    this.returnAnimationId = window.requestAnimationFrame(animate);
  }

  setBalance(value: number) {
    this.balanceEl.textContent = `Balance: $${value.toFixed(2)}`;
  }

  setLastResult(text: string, kind: 'win' | 'loss' | 'neutral') {
    this.lastResultEl.textContent = `Last result: ${text}`;
    this.lastResultEl.classList.remove('win', 'loss');
    if (kind === 'win') {
      this.lastResultEl.classList.add('win');
    } else if (kind === 'loss') {
      this.lastResultEl.classList.add('loss');
    }
  }

  setHistory(values: Array<{ value: number; highlight?: 'big' | 'jackpot' }>) {
    this.historyRailEl.innerHTML = '';
    for (const entry of values) {
      const chip = document.createElement('span');
      chip.classList.add('history-chip');
      if (entry.value < 2) {
        chip.classList.add('low');
      } else if (entry.value < 5) {
        chip.classList.add('mid');
      } else if (entry.value < 10) {
        chip.classList.add('high');
      } else {
        chip.classList.add('mega');
      }
      if (entry.highlight) {
        chip.classList.add('flash');
        if (entry.highlight === 'jackpot') {
          chip.classList.add('jackpot');
        }
      }
      chip.textContent = `${entry.value.toFixed(2)}x`;
      this.historyRailEl.appendChild(chip);
    }
  }

  setMute(muted: boolean) {
    this.muted = muted;
    this.muteBtn.textContent = this.muted ? 'Unmute' : 'Mute';
  }

  setFuelCharging(active: boolean) {
    this.fuelChargeEl.classList.toggle('hidden', !active);
  }

  showMegaWin(kind: 'big' | 'jackpot', multiplier: number) {
    if (this.megaWinTimer) {
      window.clearTimeout(this.megaWinTimer);
      this.megaWinTimer = null;
    }
    this.megaWinEl.classList.remove('hidden', 'jackpot');
    this.megaWinEl.classList.add('show');
    if (kind === 'jackpot') {
      this.megaWinEl.classList.add('jackpot');
      this.megaWinTitleEl.textContent = 'JACKPOT';
      this.megaWinSubtitleEl.textContent = `${multiplier.toFixed(2)}x`;
    } else {
      this.megaWinTitleEl.textContent = 'BIG WIN';
      this.megaWinSubtitleEl.textContent = `${multiplier.toFixed(2)}x`;
    }
    this.megaWinTimer = window.setTimeout(() => {
      this.clearMegaWin();
    }, 2800);
  }

  clearMegaWin() {
    if (this.megaWinTimer) {
      window.clearTimeout(this.megaWinTimer);
      this.megaWinTimer = null;
    }
    this.megaWinEl.classList.remove('show', 'jackpot');
    this.megaWinEl.classList.add('hidden');
  }

  clearBanner() {
    if (this.bannerTimer) {
      window.clearTimeout(this.bannerTimer);
      this.bannerTimer = null;
    }
    this.bannerEl.classList.add('hidden');
    this.bannerEl.classList.remove('show', 'cashout', 'crash');
  }

  showBanner(text: string, kind: 'cashout' | 'crash') {
    if (this.bannerTimer) {
      window.clearTimeout(this.bannerTimer);
    }
    this.bannerEl.textContent = text;
    this.bannerEl.classList.remove('hidden', 'cashout', 'crash', 'show');
    this.bannerEl.classList.add(kind, 'show');

    this.bannerTimer = window.setTimeout(() => {
      this.clearBanner();
    }, 2600);
  }

  showTooltip(text: string) {
    if (this.tooltipTimer) {
      window.clearTimeout(this.tooltipTimer);
    }
    this.tooltipEl.textContent = text;
    this.tooltipEl.classList.remove('hidden');

    this.tooltipTimer = window.setTimeout(() => {
      this.tooltipEl.classList.add('hidden');
      this.tooltipTimer = null;
    }, 1600);
  }

  private requireEl(id: string) {
    const el = document.getElementById(id);
    if (!el) {
      throw new Error(`Missing UI element #${id}`);
    }
    return el;
  }
}
