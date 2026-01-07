import * as PIXI from 'pixi.js';
import { Howl, Howler } from 'howler';
import { RNG } from './RNG';
import {
  COST_TO_PLAY,
  GameState,
  GROWTH_K,
  MAX_MULTIPLIER,
  START_BALANCE
} from './state';
import { FlashPulse, ParticleSystem, ScreenShake, clamp, lerp } from './effects';
import { UI } from './ui';

type Star = {
  sprite: PIXI.Sprite;
  speed: number;
  baseAlpha: number;
  twinkleSpeed: number;
  twinkleOffset: number;
  size: number;
};

type Ghost = {
  sprite: PIXI.Sprite;
  age: number;
  life: number;
  vx: number;
  vy: number;
  texture: PIXI.Texture;
};

type HistoryEntry = {
  value: number;
  highlight?: 'big' | 'jackpot';
};

type Galaxy = {
  sprite: PIXI.Sprite;
  speed: number;
  driftX: number;
  baseScale: number;
  baseAlpha: number;
  pulseOffset: number;
  pulseStrength: number;
  rotationSpeed: number;
  baseSize: number;
  tintFrom: number;
  tintTo: number;
};

type Nebula = {
  sprite: PIXI.Sprite;
  speed: number;
  driftX: number;
  baseScale: number;
  baseAlpha: number;
  pulseOffset: number;
  tintFrom: number;
  tintTo: number;
};

class SoundBank {
  private sounds: Record<string, Howl>;
  private engine: Howl;
  private engineId: number | null = null;
  private unlocked = false;
  private duckTimer = 0;
  private duckLevel = 1;

  constructor() {
    const click = makeTone({
      duration: 0.06,
      frequency: 620,
      volume: 0.18,
      type: 'square'
    });
    const launch = makeTone({
      duration: 0.2,
      frequency: 420,
      volume: 0.35,
      type: 'saw'
    });
    const cashout = makeTone({
      duration: 0.18,
      frequency: 980,
      volume: 0.35,
      type: 'sine'
    });
    const tick = makeTone({
      duration: 0.04,
      frequency: 860,
      volume: 0.12,
      type: 'square'
    });
    const celebrate = makeGlide({
      duration: 0.32,
      startFreq: 520,
      endFreq: 1280,
      volume: 0.38
    });
    const jackpot = makeChord({
      duration: 0.5,
      frequencies: [392, 523.25, 783.99, 1046.5],
      volume: 0.45
    });
    const crash = makeNoise({
      duration: 0.5,
      volume: 0.5
    });
    const engine = makeEngineHum({
      duration: 0.5,
      volume: 0.2
    });

    this.sounds = {
      click: new Howl({ src: [click], volume: 0.4 }),
      launch: new Howl({ src: [launch], volume: 0.55 }),
      cashout: new Howl({ src: [cashout], volume: 0.55 }),
      tick: new Howl({ src: [tick], volume: 0.22 }),
      celebrate: new Howl({ src: [celebrate], volume: 0.6 }),
      jackpot: new Howl({ src: [jackpot], volume: 0.7 }),
      crash: new Howl({ src: [crash], volume: 0.7 })
    };

    this.engine = new Howl({ src: [engine], loop: true, volume: 0 });
  }

  unlock() {
    if (this.unlocked) {
      return;
    }
    this.unlocked = true;
    if (Howler.ctx && Howler.ctx.state === 'suspended') {
      Howler.ctx.resume();
    }
  }

  setMuted(muted: boolean) {
    Howler.mute(muted);
  }

  play(
    name:
      | 'click'
      | 'launch'
      | 'cashout'
      | 'tick'
      | 'celebrate'
      | 'jackpot'
      | 'crash'
  ) {
    if (!this.unlocked) {
      return;
    }
    if (name !== 'tick') {
      this.duck(320, 0.55);
    }
    this.sounds[name].play();
  }

  startEngine() {
    if (!this.unlocked) {
      return;
    }
    if (this.engineId === null || !this.engine.playing(this.engineId)) {
      this.engineId = this.engine.play();
    }
    if (this.engineId !== null) {
      this.engine.volume(0, this.engineId);
      this.engine.fade(0, 0.25, 280, this.engineId);
    }
  }

  stopEngine() {
    if (!this.unlocked || this.engineId === null) {
      return;
    }
    const id = this.engineId;
    const currentVolume = this.engine.volume(id);
    this.engine.fade(currentVolume, 0, 220, id);
    window.setTimeout(() => {
      this.engine.stop(id);
      this.engineId = null;
    }, 240);
  }

  updateEngine(multiplier: number, flightIntensity: number, dt: number) {
    if (!this.unlocked || this.engineId === null) {
      return;
    }
    if (this.duckTimer > 0) {
      this.duckTimer = Math.max(0, this.duckTimer - dt);
    } else {
      this.duckLevel = lerp(this.duckLevel, 1, dt * 3);
    }

    const boost = clamp((multiplier - 1) / 9, 0, 1);
    const rate = lerp(0.9, 1.35, boost);
    const baseVolume = 0.22 * flightIntensity;
    const targetVolume = baseVolume * this.duckLevel;
    this.engine.rate(rate, this.engineId);
    this.engine.volume(targetVolume, this.engineId);
  }

  private duck(durationMs: number, depth: number) {
    this.duckTimer = Math.max(this.duckTimer, durationMs / 1000);
    this.duckLevel = Math.min(this.duckLevel, depth);
  }
}

export class Game {
  private app: PIXI.Application;
  private world = new PIXI.Container();
  private backgroundLayer = new PIXI.Container();
  private nebulaLayer = new PIXI.Container();
  private galaxyLayer = new PIXI.Container();
  private gameLayer = new PIXI.Container();
  private effectsLayer = new PIXI.Container();
  private flashSprite = new PIXI.Sprite(PIXI.Texture.WHITE);

  private rng = new RNG();
  private ui: UI;
  private audio = new SoundBank();

  private state: GameState = GameState.IDLE;
  private balance = START_BALANCE;
  private currentMultiplier = 1;
  private crashMultiplier = MAX_MULTIPLIER;
  private roundTime = 0;
  private endTimer = 0;
  private cashoutLocked = false;
  private crashLocked = false;
  private muted = false;

  private viewWidth = 0;
  private viewHeight = 0;

  private rocket = new PIXI.Container();
  private flame = new PIXI.Graphics();
  private rocketAura = new PIXI.Graphics();
  private stars: Star[] = [];
  private nebulae: Nebula[] = [];
  private galaxies: Galaxy[] = [];
  private nebulaTextures: PIXI.Texture[] = [];
  private galaxyTextures: PIXI.Texture[] = [];
  private dustTextures: PIXI.Texture[] = [];

  private particles = new ParticleSystem(this.effectsLayer, 480);
  private twinkles = new ParticleSystem(this.backgroundLayer, 80);
  private shake = new ScreenShake();
  private flash = new FlashPulse();
  private ghosts: Ghost[] = [];

  private sparkAccumulator = 0;
  private smokeAccumulator = 0;
  private speedLineAccumulator = 0;
  private twinkleAccumulator = 0;
  private elapsed = 0;
  private flightIntensity = 0;
  private cameraY = 0;
  private history: HistoryEntry[] = [];
  private lastTickStep = 10;

  constructor(root: HTMLElement) {
    this.app = new PIXI.Application({
      antialias: true,
      backgroundAlpha: 0,
      autoDensity: true,
      resizeTo: window,
      resolution: window.devicePixelRatio || 1
    });

    root.appendChild(this.app.view as HTMLCanvasElement);

    this.world.addChild(this.backgroundLayer, this.gameLayer, this.effectsLayer);
    this.backgroundLayer.addChild(this.nebulaLayer, this.galaxyLayer);
    this.app.stage.addChild(this.world);

    this.flashSprite.tint = 0xffffff;
    this.flashSprite.alpha = 0;
    this.app.stage.addChild(this.flashSprite);

    this.ui = new UI({
      onPlay: () => this.startRound(),
      onCashOut: () => this.cashOut(),
      onToggleMute: () => this.toggleMute(),
      onUserGesture: () => this.audio.unlock()
    });

    this.ui.setBalance(this.balance);
    this.ui.setPotential(COST_TO_PLAY);
    this.ui.setState(this.state);
    this.ui.setHistory(this.history);

    this.buildRocket();
    this.resize();
    window.addEventListener('resize', () => this.resize());

    window.addEventListener('keydown', (event) => {
      if (event.code === 'Space' && this.state === GameState.RUNNING) {
        event.preventDefault();
        this.cashOut();
      }
    });

    this.app.ticker.add(() => {
      const dt = this.app.ticker.deltaMS / 1000;
      this.update(dt);
    });
  }

  private buildRocket() {
    this.rocketAura.beginFill(0x6dd3ff, 0.16);
    this.rocketAura.drawEllipse(0, 0, 46, 26);
    this.rocketAura.endFill();
    this.rocketAura.beginFill(0x59ffb2, 0.1);
    this.rocketAura.drawEllipse(0, 0, 30, 18);
    this.rocketAura.endFill();
    this.rocketAura.blendMode = PIXI.BLEND_MODES.SCREEN;
    this.rocketAura.alpha = 0.2;

    const body = new PIXI.Graphics();
    body.beginFill(0xe6f6ff);
    body.drawRoundedRect(-14, -36, 28, 72, 12);
    body.endFill();

    const nose = new PIXI.Graphics();
    nose.beginFill(0xffd166);
    nose.drawPolygon([0, -52, -14, -30, 14, -30]);
    nose.endFill();

    const windowGlass = new PIXI.Graphics();
    windowGlass.beginFill(0x0b1b3d);
    windowGlass.drawCircle(0, -8, 6);
    windowGlass.endFill();
    windowGlass.lineStyle(2, 0x8be9ff);
    windowGlass.drawCircle(0, -8, 6);

    const finLeft = new PIXI.Graphics();
    finLeft.beginFill(0xff7f50);
    finLeft.drawPolygon([-14, 14, -30, 34, -14, 34]);
    finLeft.endFill();

    const finRight = new PIXI.Graphics();
    finRight.beginFill(0xff7f50);
    finRight.drawPolygon([14, 14, 30, 34, 14, 34]);
    finRight.endFill();

    this.flame.beginFill(0xff5d4a);
    this.flame.drawPolygon([0, 54, -8, 28, 8, 28]);
    this.flame.endFill();
    this.flame.beginFill(0xffd166);
    this.flame.drawPolygon([0, 44, -4, 28, 4, 28]);
    this.flame.endFill();
    this.flame.alpha = 0.8;

    this.rocket.addChild(
      this.rocketAura,
      this.flame,
      body,
      nose,
      windowGlass,
      finLeft,
      finRight
    );
    this.gameLayer.addChild(this.rocket);
  }

  private resize() {
    const { width, height } = this.app.renderer;
    const resolution = this.app.renderer.resolution || 1;
    this.viewWidth = width / resolution;
    this.viewHeight = height / resolution;

    this.flashSprite.width = this.viewWidth;
    this.flashSprite.height = this.viewHeight;

    this.createNebulae();
    this.createGalaxies();

    if (this.stars.length === 0) {
      this.createStarfield();
    } else {
      for (const star of this.stars) {
        star.sprite.x = Math.random() * this.viewWidth;
        star.sprite.y = Math.random() * this.viewHeight;
      }
    }
  }

  private createNebulae() {
    const old = this.nebulaLayer.removeChildren();
    for (const child of old) {
      child.destroy();
    }
    this.nebulae = [];
    this.buildNebulaTextures();

    const palette = [
      { from: 0x071425, to: 0x40e3ff },
      { from: 0x140c2b, to: 0xff7bdc },
      { from: 0x061a1f, to: 0x7dffb6 },
      { from: 0x1b0f24, to: 0xffb36b }
    ];

    const nebulaCount = Math.max(4, Math.floor(this.viewWidth / 360));

    for (let i = 0; i < nebulaCount; i += 1) {
      const tint = palette[i % palette.length];
      const texture = this.nebulaTextures[i % this.nebulaTextures.length];
      this.spawnNebula(texture, tint.from, tint.to, {
        baseScale: 1.1 + Math.random() * 0.8,
        baseAlpha: 0.16 + Math.random() * 0.08,
        speed: 0.6 + Math.random() * 1.2,
        drift: 1.8 + Math.random() * 1.6
      });
    }
  }

  private createGalaxies() {
    const old = this.galaxyLayer.removeChildren();
    for (const child of old) {
      child.destroy();
    }
    this.galaxies = [];
    this.buildGalaxyTextures();

    const palette = [
      { from: 0x13213b, to: 0x5fe2ff },
      { from: 0x2a143d, to: 0xff8fe8 },
      { from: 0x0e2332, to: 0x6dffcc },
      { from: 0x2b1220, to: 0xffb36b }
    ];

    const galaxyCount = Math.max(4, Math.floor(this.viewWidth / 420));
    const dustCount = Math.max(6, Math.floor(this.viewWidth / 360));

    for (let i = 0; i < galaxyCount; i += 1) {
      const tint = palette[i % palette.length];
      const texture = this.galaxyTextures[i % this.galaxyTextures.length];
      this.spawnGalaxy(texture, tint.from, tint.to, {
        baseScale: 0.8 + Math.random() * 0.6,
        baseAlpha: 0.18 + Math.random() * 0.12,
        speed: 2.5 + Math.random() * 3,
        drift: 3 + Math.random() * 4,
        pulseStrength: 0.7
      });
    }

    for (let i = 0; i < dustCount; i += 1) {
      const tint = palette[(i + 1) % palette.length];
      const texture = this.dustTextures[i % this.dustTextures.length];
      this.spawnGalaxy(texture, tint.from, tint.to, {
        baseScale: 0.6 + Math.random() * 0.5,
        baseAlpha: 0.12 + Math.random() * 0.1,
        speed: 1.4 + Math.random() * 2,
        drift: 2 + Math.random() * 3,
        pulseStrength: 0.4
      });
    }
  }

  private spawnNebula(
    texture: PIXI.Texture,
    tintFrom: number,
    tintTo: number,
    options: {
      baseScale: number;
      baseAlpha: number;
      speed: number;
      drift: number;
    }
  ) {
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.blendMode = PIXI.BLEND_MODES.SCREEN;
    sprite.x = Math.random() * this.viewWidth;
    sprite.y = Math.random() * this.viewHeight;
    sprite.alpha = options.baseAlpha;
    sprite.scale.set(options.baseScale);
    sprite.rotation = Math.random() * Math.PI * 2;
    sprite.tint = tintFrom;
    this.nebulaLayer.addChild(sprite);
    this.nebulae.push({
      sprite,
      speed: options.speed,
      driftX: (Math.random() - 0.5) * options.drift,
      baseScale: options.baseScale,
      baseAlpha: options.baseAlpha,
      pulseOffset: Math.random() * Math.PI * 2,
      tintFrom,
      tintTo
    });
  }

  private createStarfield() {
    const starCount = Math.floor((this.viewWidth * this.viewHeight) / 7000);
    const layers = [
      { count: Math.max(50, starCount), speed: 16, size: 0.9 },
      { count: Math.max(40, starCount * 0.85), speed: 30, size: 1.2 },
      { count: Math.max(30, starCount * 0.7), speed: 52, size: 1.6 }
    ];

    for (const layer of layers) {
      for (let i = 0; i < layer.count; i += 1) {
        const sprite = new PIXI.Sprite(PIXI.Texture.WHITE);
        sprite.anchor.set(0.5);
        sprite.tint = 0xffffff;
        sprite.alpha = 0.2 + Math.random() * 0.5;
        const size = layer.size + Math.random() * 0.6;
        sprite.scale.set(size, size);
        sprite.x = Math.random() * this.viewWidth;
        sprite.y = Math.random() * this.viewHeight;
        this.backgroundLayer.addChild(sprite);
        this.stars.push({
          sprite,
          speed: layer.speed + Math.random() * 8,
          baseAlpha: sprite.alpha,
          twinkleSpeed: 1 + Math.random() * 2,
          twinkleOffset: Math.random() * Math.PI * 2,
          size
        });
      }
    }
  }

  private buildNebulaTextures() {
    if (this.nebulaTextures.length > 0) {
      return;
    }

    this.nebulaTextures = [
      this.makeNebulaTexture(960),
      this.makeNebulaTexture(860),
      this.makeNebulaTexture(760)
    ];
  }

  private makeNebulaTexture(size: number) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return PIXI.Texture.WHITE;
    }

    ctx.clearRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'lighter';

    const accents = [
      'rgba(80, 220, 255, 0.25)',
      'rgba(255, 140, 220, 0.2)',
      'rgba(120, 255, 180, 0.2)',
      'rgba(255, 190, 120, 0.18)'
    ];

    for (let i = 0; i < 6; i += 1) {
      const x = Math.random() * size * 0.8 + size * 0.1;
      const y = Math.random() * size * 0.8 + size * 0.1;
      const radius = size * (0.25 + Math.random() * 0.25);
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, accents[i % accents.length]);
      gradient.addColorStop(0.6, 'rgba(30, 60, 120, 0.06)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    }

    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 220; i += 1) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const radius = Math.random() * 2.2 + 0.4;
      ctx.globalAlpha = 0.05 + Math.random() * 0.08;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,1)';
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    return PIXI.Texture.from(canvas);
  }

  private spawnGalaxy(
    texture: PIXI.Texture,
    tintFrom: number,
    tintTo: number,
    options: {
      baseScale: number;
      baseAlpha: number;
      speed: number;
      drift: number;
      pulseStrength: number;
    }
  ) {
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.blendMode = PIXI.BLEND_MODES.SCREEN;
    sprite.x = Math.random() * this.viewWidth;
    sprite.y = Math.random() * this.viewHeight;
    sprite.alpha = options.baseAlpha;
    sprite.scale.set(options.baseScale);
    sprite.tint = tintFrom;
    this.galaxyLayer.addChild(sprite);
    this.galaxies.push({
      sprite,
      speed: options.speed,
      driftX: (Math.random() - 0.5) * options.drift,
      baseScale: options.baseScale,
      baseAlpha: options.baseAlpha,
      pulseOffset: Math.random() * Math.PI * 2,
      pulseStrength: options.pulseStrength,
      rotationSpeed: (Math.random() - 0.5) * 0.03,
      baseSize: texture.width,
      tintFrom,
      tintTo
    });
  }

  private buildGalaxyTextures() {
    if (this.galaxyTextures.length > 0) {
      return;
    }

    this.galaxyTextures = [
      this.makeGalaxyTexture(720, 220),
      this.makeGalaxyTexture(640, 180),
      this.makeGalaxyTexture(560, 160)
    ];
    this.dustTextures = [
      this.makeDustTexture(420, 260),
      this.makeDustTexture(360, 220)
    ];
  }

  private makeGalaxyTexture(size: number, dustCount: number) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return PIXI.Texture.WHITE;
    }

    const center = size / 2;
    const baseGradient = ctx.createRadialGradient(
      center,
      center,
      0,
      center,
      center,
      size * 0.5
    );
    baseGradient.addColorStop(0, 'rgba(255,255,255,0.85)');
    baseGradient.addColorStop(0.45, 'rgba(255,255,255,0.32)');
    baseGradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = baseGradient;
    ctx.fillRect(0, 0, size, size);

    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(Math.random() * Math.PI);
    ctx.scale(1.4, 0.7);
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fill();
    ctx.restore();

    for (let i = 0; i < dustCount; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * size * 0.4;
      const x = center + Math.cos(angle) * radius;
      const y = center + Math.sin(angle) * radius;
      const dotSize = Math.random() * 2.2 + 0.4;
      ctx.globalAlpha = 0.15 + Math.random() * 0.35;
      ctx.beginPath();
      ctx.arc(x, y, dotSize, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,1)';
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    return PIXI.Texture.from(canvas);
  }

  private makeDustTexture(size: number, dotCount: number) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return PIXI.Texture.WHITE;
    }

    for (let i = 0; i < dotCount; i += 1) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const radius = Math.random() * 1.4 + 0.3;
      ctx.globalAlpha = 0.08 + Math.random() * 0.25;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,1)';
      ctx.fill();
    }

    const haze = ctx.createRadialGradient(
      size * 0.5,
      size * 0.5,
      0,
      size * 0.5,
      size * 0.5,
      size * 0.6
    );
    haze.addColorStop(0, 'rgba(255,255,255,0.35)');
    haze.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, size, size);

    ctx.globalAlpha = 1;
    return PIXI.Texture.from(canvas);
  }

  private updateNebulae(dt: number) {
    const speedBoost =
      this.flightIntensity * (this.currentMultiplier - 1) * 2.4;
    const glowBoost = clamp((this.currentMultiplier - 1) / 10, 0, 1);

    for (const nebula of this.nebulae) {
      const drift = nebula.speed * this.flightIntensity;
      nebula.sprite.y += (drift + speedBoost * 0.12) * dt;
      nebula.sprite.x += nebula.driftX * dt * this.flightIntensity;

      const pulse =
        Math.sin(this.elapsed * 0.25 + nebula.pulseOffset) * 0.06;
      const scaleBoost = 1 + pulse + glowBoost * 0.12;
      nebula.sprite.scale.set(nebula.baseScale * scaleBoost);

      const idleDim = 0.6 + this.flightIntensity * 0.4;
      nebula.sprite.alpha =
        nebula.baseAlpha * (0.7 + glowBoost * 0.6) * idleDim;
      nebula.sprite.tint = lerpColor(nebula.tintFrom, nebula.tintTo, glowBoost);

      const radius = Math.max(nebula.sprite.width, nebula.sprite.height) * 0.5;
      if (nebula.sprite.y - radius > this.viewHeight + 200) {
        nebula.sprite.y = -radius - 200;
        nebula.sprite.x = Math.random() * this.viewWidth;
      }
      if (nebula.sprite.x < -radius - 200) {
        nebula.sprite.x = this.viewWidth + radius + 200;
      } else if (nebula.sprite.x > this.viewWidth + radius + 200) {
        nebula.sprite.x = -radius - 200;
      }
    }
  }

  private updateGalaxies(dt: number) {
    const speedBoost =
      this.flightIntensity * (this.currentMultiplier - 1) * 5;
    const glowBoost = clamp((this.currentMultiplier - 1) / 8, 0, 1);

    for (const galaxy of this.galaxies) {
      const drift = galaxy.speed * this.flightIntensity;
      galaxy.sprite.y += (drift + speedBoost * 0.2) * dt;
      galaxy.sprite.x += galaxy.driftX * dt * this.flightIntensity;
      galaxy.sprite.rotation += galaxy.rotationSpeed * dt * this.flightIntensity;

      const pulseFactor = galaxy.pulseStrength * (0.25 + glowBoost * 0.75);
      const pulse =
        Math.sin(this.elapsed * 0.6 + galaxy.pulseOffset) * 0.05 * pulseFactor;
      const scaleBoost =
        1 + pulse + glowBoost * 0.15 * galaxy.pulseStrength;
      galaxy.sprite.scale.set(galaxy.baseScale * scaleBoost);
      const idleDim = 0.7 + this.flightIntensity * 0.3;
      galaxy.sprite.alpha =
        galaxy.baseAlpha *
        (0.75 + glowBoost * 0.8) *
        (1 + pulse * 0.8) *
        idleDim;
      galaxy.sprite.tint = lerpColor(galaxy.tintFrom, galaxy.tintTo, glowBoost);

      const radius = galaxy.baseSize * galaxy.baseScale * scaleBoost * 0.5;
      if (galaxy.sprite.y - radius > this.viewHeight + 160) {
        galaxy.sprite.y = -radius - 140;
        galaxy.sprite.x = Math.random() * this.viewWidth;
        galaxy.driftX = (Math.random() - 0.5) * 8;
      }
      if (galaxy.sprite.x < -radius - 180) {
        galaxy.sprite.x = this.viewWidth + radius + 180;
      } else if (galaxy.sprite.x > this.viewWidth + radius + 180) {
        galaxy.sprite.x = -radius - 180;
      }
    }
  }

  private update(dt: number) {
    this.elapsed += dt;
    const targetIntensity = this.state === GameState.RUNNING ? 1 : 0;
    const ease = 1 - Math.exp(-dt * 2.4);
    this.flightIntensity = lerp(this.flightIntensity, targetIntensity, ease);
    this.audio.updateEngine(this.currentMultiplier, this.flightIntensity, dt);
    this.updateNebulae(dt);
    this.updateGalaxies(dt);
    this.updateStars(dt);
    this.shake.update(dt);
    this.flash.update(dt);
    this.flashSprite.alpha = this.flash.alpha;

    if (this.state === GameState.RUNNING) {
      this.roundTime += dt;
      this.currentMultiplier = Math.min(
        MAX_MULTIPLIER,
        Math.exp(GROWTH_K * this.roundTime)
      );
      this.ui.setMultiplier(this.currentMultiplier);
      this.ui.setPotential(COST_TO_PLAY * this.currentMultiplier);
      this.emitEngineParticles(dt);
      this.emitSpeedLines(dt);

      const tickStep = Math.floor(this.currentMultiplier * 10);
      if (tickStep > this.lastTickStep) {
        this.lastTickStep = tickStep;
        this.audio.play('tick');
      }

      if (this.currentMultiplier >= this.crashMultiplier) {
        this.crash();
      }
    }

    if (this.state === GameState.CASHED_OUT || this.state === GameState.CRASHED) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) {
        this.resetRound();
      }
    }

    this.updateRocket(dt);
    this.updateGhosts(dt);
    this.particles.update(dt);
    this.twinkles.update(dt);
    this.updateCamera();
  }

  private updateStars(dt: number) {
    const speedBoost =
      this.flightIntensity * (this.currentMultiplier - 1) * 20;
    const stretch = clamp(
      1 + (speedBoost + 6 * this.flightIntensity) / 160,
      1,
      2.4
    );
    const glowBoost = clamp((this.currentMultiplier - 1) / 8, 0, 1);
    const starTint = lerpColor(0x3d8fb3, 0xffa8e8, glowBoost);

    for (const star of this.stars) {
      const drift = star.speed * this.flightIntensity;
      star.sprite.y += (drift + speedBoost) * dt;
      if (star.sprite.y > this.viewHeight + 20) {
        star.sprite.y = -20;
        star.sprite.x = Math.random() * this.viewWidth;
      }
      const twinkle =
        star.baseAlpha +
        Math.sin(this.elapsed * star.twinkleSpeed + star.twinkleOffset) *
          (0.14 + glowBoost * 0.3);
      const idleDim = 0.65 + this.flightIntensity * 0.35;
      star.sprite.alpha = clamp(twinkle * idleDim, 0.08, 1);
      star.sprite.scale.set(star.size, star.size * stretch);
      star.sprite.tint = starTint;
    }

    this.twinkleAccumulator +=
      dt * (0.4 + this.flightIntensity * (3.2 + glowBoost * 2));
    while (this.twinkleAccumulator >= 1) {
      this.twinkleAccumulator -= 1;
      const x = Math.random() * this.viewWidth;
      const y = Math.random() * this.viewHeight * 0.6;
      const size = 1.5 + Math.random() * 2;
      const drift = 18 * this.flightIntensity;
      this.twinkles.spawn(
        x,
        y,
        0,
        drift + Math.random() * drift,
        0,
        0,
        1.2 + Math.random() * 0.6,
        0xffffff,
        size,
        size,
        size * 1.6,
        size * 1.6,
        0.7,
        0,
        Math.random() * Math.PI,
        0
      );
    }
  }

  private updateRocket(dt: number) {
    const rise =
      clamp((this.currentMultiplier - 1) / (MAX_MULTIPLIER - 1), 0, 1) *
      this.viewHeight *
      0.32 *
      this.flightIntensity;
    const idleY = this.viewHeight * 0.72;
    const launchY = this.viewHeight * 0.6;
    const baseY = lerp(idleY, launchY, this.flightIntensity);
    const bob = Math.sin(this.elapsed * 2.2) * 6;
    const sway = Math.sin(this.elapsed * 1.1) * 8;
    const targetY = baseY - rise + bob;
    const targetX = this.viewWidth * 0.5 + sway;

    this.rocket.x = lerp(this.rocket.x, targetX, 0.08);
    this.rocket.y = lerp(this.rocket.y, targetY, 0.08);

    const tilt = clamp((this.currentMultiplier - 1) * 0.018, 0, 0.35);
    this.rocket.rotation = lerp(this.rocket.rotation, tilt, 0.1);

    const flameBase = this.state === GameState.RUNNING ? 1 : 0.35;
    const flameWobble =
      Math.sin(this.elapsed * 12) * 0.15 + Math.sin(this.elapsed * 7.3) * 0.08;
    const flameScale = clamp(flameBase + flameWobble, 0.25, 1.3);
    this.flame.scale.set(1, flameScale);
    this.flame.alpha = clamp(0.5 + flameWobble, 0.25, 0.9);

    const auraPulse = 0.95 + Math.sin(this.elapsed * 3.4) * 0.06;
    const auraScale = clamp(0.9 + (this.currentMultiplier - 1) * 0.05, 0.9, 1.6);
    this.rocketAura.scale.set(auraScale * auraPulse, auraScale * 0.85 * auraPulse);
    this.rocketAura.alpha = clamp(
      0.12 + (this.currentMultiplier - 1) * 0.02,
      0.12,
      0.38
    );
  }

  private updateCamera() {
    const targetCameraY = this.viewHeight * 0.6 - this.rocket.y;
    this.cameraY = lerp(this.cameraY, targetCameraY, 0.08);

    this.world.x = this.shake.offsetX;
    this.world.y = this.cameraY + this.shake.offsetY;
  }

  private emitEngineParticles(dt: number) {
    const engineX = this.rocket.x;
    const engineY = this.rocket.y + 40;
    const speedScale = 1 + (this.currentMultiplier - 1) * 0.08;

    this.sparkAccumulator += dt * 45 * speedScale;
    while (this.sparkAccumulator >= 1) {
      this.sparkAccumulator -= 1;
      const angle = Math.PI + (Math.random() - 0.5) * 0.7;
      const speed = 80 + Math.random() * 70;
      this.particles.spawn(
        engineX,
        engineY,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        0,
        60,
        0.4 + Math.random() * 0.2,
        0xffd166,
        2,
        2,
        0.5,
        0.5,
        0.9,
        0,
        0,
        (Math.random() - 0.5) * 3
      );
    }

    this.smokeAccumulator += dt * 6;
    while (this.smokeAccumulator >= 1) {
      this.smokeAccumulator -= 1;
      const drift = (Math.random() - 0.5) * 20;
      this.particles.spawn(
        engineX + drift,
        engineY + 6,
        drift * 0.5,
        30 + Math.random() * 20,
        0,
        10,
        0.8 + Math.random() * 0.4,
        0x93a7b8,
        5,
        5,
        14,
        14,
        0.25,
        0,
        Math.random() * Math.PI,
        (Math.random() - 0.5) * 0.6
      );
    }
  }

  private emitSpeedLines(dt: number) {
    const threshold = 1.6;
    const intensity = clamp((this.currentMultiplier - threshold) / 6, 0, 1);
    if (intensity <= 0) {
      return;
    }

    this.speedLineAccumulator += dt * (6 + intensity * 26);

    while (this.speedLineAccumulator >= 1) {
      this.speedLineAccumulator -= 1;
      const x =
        this.rocket.x + (Math.random() - 0.5) * this.viewWidth * 0.6;
      const y =
        this.rocket.y + (Math.random() - 0.5) * this.viewHeight * 0.4;
      const length = 14 + Math.random() * (40 + intensity * 30);
      const thickness = 0.8 + Math.random() * 1.2;
      const lineTint = lerpColor(0x7fd2ff, 0xff8fb5, intensity * 0.6);
      this.particles.spawn(
        x,
        y,
        0,
        140 + Math.random() * (120 + intensity * 80),
        0,
        0,
        0.5,
        lineTint,
        length,
        thickness,
        length * 0.6,
        thickness,
        0.6,
        0,
        0,
        0
      );
    }
  }

  private emitCashout() {
    const x = this.rocket.x;
    const y = this.rocket.y - 10;
    const colors = [0xffd166, 0x59ffb2, 0x6dd3ff, 0xff8fab];

    for (let i = 0; i < 36; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 120 + Math.random() * 140;
      const tint = colors[i % colors.length];
      this.particles.spawn(
        x,
        y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        0,
        180,
        0.9 + Math.random() * 0.4,
        tint,
        4,
        4,
        1,
        1,
        1,
        0,
        Math.random() * Math.PI,
        (Math.random() - 0.5) * 6
      );
    }
  }

  private emitCelebration(isJackpot: boolean) {
    const x = this.rocket.x;
    const y = this.rocket.y - 20;
    const colors = [
      0xffd166,
      0x59ffb2,
      0x6dd3ff,
      0xff8fd1,
      0xffffff
    ];
    const confettiCount = isJackpot ? 120 : 70;
    const baseSpeed = isJackpot ? 240 : 160;
    const gravity = isJackpot ? 260 : 200;
    const baseLife = isJackpot ? 1.6 : 1.2;

    for (let i = 0; i < confettiCount; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = baseSpeed + Math.random() * 140;
      const width = 4 + Math.random() * (isJackpot ? 6 : 4);
      const height = 2 + Math.random() * (isJackpot ? 4 : 3);
      const tint = colors[i % colors.length];
      this.particles.spawn(
        x,
        y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        0,
        gravity,
        baseLife + Math.random() * 0.6,
        tint,
        width,
        height,
        width * 0.6,
        height * 0.6,
        1,
        0,
        Math.random() * Math.PI,
        (Math.random() - 0.5) * 10
      );
    }

    const sparkleCount = isJackpot ? 40 : 24;
    for (let i = 0; i < sparkleCount; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (isJackpot ? 220 : 160) + Math.random() * 100;
      this.particles.spawn(
        x,
        y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        0,
        80,
        0.6 + Math.random() * 0.4,
        0xffffff,
        2.2,
        2.2,
        0.6,
        0.6,
        0.9,
        0,
        Math.random() * Math.PI,
        0
      );
    }

    const rainCount = isJackpot ? 80 : 45;
    for (let i = 0; i < rainCount; i += 1) {
      const xPos = Math.random() * this.viewWidth;
      const yPos = -40 - Math.random() * this.viewHeight * 0.2;
      const vx = (Math.random() - 0.5) * 60;
      const vy = 160 + Math.random() * (isJackpot ? 200 : 140);
      const width = 3 + Math.random() * (isJackpot ? 5 : 4);
      const height = 1.5 + Math.random() * 2.5;
      const tint = colors[(i + 2) % colors.length];
      this.particles.spawn(
        xPos,
        yPos,
        vx,
        vy,
        0,
        140,
        1.3 + Math.random() * 0.6,
        tint,
        width,
        height,
        width,
        height,
        0.85,
        0,
        Math.random() * Math.PI,
        (Math.random() - 0.5) * 6
      );
    }

    if (isJackpot) {
      for (let i = 0; i < 32; i += 1) {
        const angle = (i / 32) * Math.PI * 2;
        const speed = 260 + Math.random() * 120;
        const length = 18 + Math.random() * 26;
        this.particles.spawn(
          x,
          y,
          Math.cos(angle) * speed,
          Math.sin(angle) * speed,
          0,
          0,
          0.6,
          0xfff3b0,
          length,
          2,
          length * 0.5,
          1,
          0.8,
          0,
          angle,
          0
        );
      }
      this.flash.trigger(0.45, 0.22);
    }
  }

  private emitExplosion() {
    const x = this.rocket.x;
    const y = this.rocket.y;

    for (let i = 0; i < 50; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 180 + Math.random() * 220;
      this.particles.spawn(
        x,
        y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        0,
        120,
        0.8 + Math.random() * 0.4,
        0xff7b54,
        5,
        5,
        1,
        1,
        1,
        0,
        Math.random() * Math.PI,
        (Math.random() - 0.5) * 8
      );
    }

    for (let i = 0; i < 24; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 100 + Math.random() * 140;
      this.particles.spawn(
        x,
        y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        0,
        200,
        1.2 + Math.random() * 0.6,
        0x74808a,
        6,
        2,
        3,
        1,
        0.8,
        0,
        Math.random() * Math.PI,
        (Math.random() - 0.5) * 10
      );
    }
  }

  private spawnRocketGhosts() {
    const tints = [0xff5d6c, 0x6dd3ff];

    for (let i = 0; i < tints.length; i += 1) {
      const texture = this.app.renderer.generateTexture(this.rocket);
      const sprite = new PIXI.Sprite(texture);
      sprite.anchor.set(0.5);
      sprite.position.set(this.rocket.x, this.rocket.y);
      sprite.rotation = this.rocket.rotation;
      sprite.tint = tints[i];
      sprite.alpha = 0.6;
      this.effectsLayer.addChild(sprite);
      this.ghosts.push({
        sprite,
        age: 0,
        life: 0.35 + i * 0.05,
        vx: (i === 0 ? -1 : 1) * 40,
        vy: -30,
        texture
      });
    }
  }

  private updateGhosts(dt: number) {
    for (let i = this.ghosts.length - 1; i >= 0; i -= 1) {
      const ghost = this.ghosts[i];
      ghost.age += dt;
      ghost.sprite.x += ghost.vx * dt;
      ghost.sprite.y += ghost.vy * dt;
      ghost.sprite.alpha = clamp(1 - ghost.age / ghost.life, 0, 1) * 0.6;
      if (ghost.age >= ghost.life) {
        ghost.sprite.removeFromParent();
        ghost.sprite.destroy();
        ghost.texture.destroy(true);
        this.ghosts.splice(i, 1);
      }
    }
  }

  private async startRound() {
    if (this.state !== GameState.IDLE) {
      return;
    }

    this.ui.clearBanner();
    this.ui.clearMegaWin();

    if (this.balance < COST_TO_PLAY) {
      this.ui.showTooltip('Balance too low to play.');
      return;
    }

    this.audio.unlock();
    this.audio.play('click');

    this.state = GameState.FETCHING_RNG;
    this.ui.setState(this.state);

    this.balance -= COST_TO_PLAY;
    this.ui.setBalance(this.balance);

    this.roundTime = 0;
    this.currentMultiplier = 1;
    this.crashMultiplier = MAX_MULTIPLIER;
    this.cashoutLocked = false;
    this.crashLocked = false;
    this.lastTickStep = Math.floor(this.currentMultiplier * 10);
    this.ui.setMultiplier(this.currentMultiplier);
    this.ui.setPotential(COST_TO_PLAY);

    const chargeStart = performance.now();
    const crash = await this.rng.getCrashMultiplier();
    const chargeElapsed = performance.now() - chargeStart;
    const minChargeMs = 600;
    if (chargeElapsed < minChargeMs) {
      await new Promise((resolve) =>
        window.setTimeout(resolve, minChargeMs - chargeElapsed)
      );
    }
    if (this.state !== GameState.FETCHING_RNG) {
      return;
    }

    this.crashMultiplier = crash;
    this.state = GameState.RUNNING;
    this.ui.setState(this.state);
    this.audio.play('launch');
    this.audio.startEngine();
  }

  private cashOut() {
    if (this.state !== GameState.RUNNING || this.cashoutLocked) {
      return;
    }

    this.cashoutLocked = true;
    const payout = COST_TO_PLAY * this.currentMultiplier;
    this.balance += payout;

    this.state = GameState.CASHED_OUT;
    this.endTimer = 1.6;
    this.ui.setState(this.state);
    this.ui.setBalance(this.balance);
    this.ui.setLastResult(`Win +$${payout.toFixed(2)}`, 'win');
    this.ui.showBanner(`CASHED OUT at ${this.currentMultiplier.toFixed(2)}x!`, 'cashout');
    this.ui.animateReturn(COST_TO_PLAY, payout, 900);

    this.spawnRocketGhosts();
    this.emitCashout();
    this.audio.play('cashout');
    const isJackpot = this.currentMultiplier >= MAX_MULTIPLIER - 0.01;
    if (isJackpot) {
      this.ui.showMegaWin('jackpot', this.currentMultiplier);
      this.emitCelebration(true);
      this.audio.play('jackpot');
      this.recordHistory(this.crashMultiplier, 'jackpot');
    } else if (this.currentMultiplier >= 10) {
      this.ui.showMegaWin('big', this.currentMultiplier);
      this.emitCelebration(false);
      this.audio.play('celebrate');
      this.recordHistory(this.crashMultiplier, 'big');
    } else {
      this.recordHistory(this.crashMultiplier);
    }
    this.audio.stopEngine();
  }

  private crash() {
    if (this.state !== GameState.RUNNING || this.crashLocked) {
      return;
    }

    this.crashLocked = true;
    this.state = GameState.CRASHED;
    this.endTimer = 1.6;
    this.ui.setState(this.state);
    this.ui.setLastResult(`Loss -$${COST_TO_PLAY.toFixed(2)}`, 'loss');
    this.ui.showBanner(`CRASHED at ${this.currentMultiplier.toFixed(2)}x`, 'crash');
    this.ui.animateReturn(COST_TO_PLAY * this.currentMultiplier, 0, 700);
    this.recordHistory(this.crashMultiplier);

    this.spawnRocketGhosts();
    this.emitExplosion();
    this.flash.trigger(0.8, 0.15);
    this.shake.start(12, 0.4);
    this.audio.play('crash');
    this.audio.stopEngine();
  }

  private resetRound() {
    this.state = GameState.IDLE;
    this.currentMultiplier = 1;
    this.roundTime = 0;
    this.endTimer = 0;
    this.crashMultiplier = MAX_MULTIPLIER;
    this.cashoutLocked = false;
    this.crashLocked = false;
    this.lastTickStep = Math.floor(this.currentMultiplier * 10);
    this.ui.setState(this.state);
    this.ui.setMultiplier(this.currentMultiplier);
    this.ui.setPotential(COST_TO_PLAY);
  }

  private recordHistory(value: number, highlight?: 'big' | 'jackpot') {
    const entry: HistoryEntry = {
      value: Math.min(MAX_MULTIPLIER, value),
      highlight
    };
    this.history.unshift(entry);
    if (this.history.length > 12) {
      this.history.length = 12;
    }
    this.ui.setHistory(this.history);
  }

  private toggleMute() {
    const nextMuted = !this.muted;
    if (nextMuted) {
      this.audio.play('click');
      this.audio.setMuted(true);
    } else {
      this.audio.setMuted(false);
      this.audio.play('click');
    }
    this.muted = nextMuted;
    this.ui.setMute(this.muted);
  }

}

const lerpColor = (from: number, to: number, t: number) => {
  const clamped = clamp(t, 0, 1);
  const r1 = (from >> 16) & 0xff;
  const g1 = (from >> 8) & 0xff;
  const b1 = from & 0xff;
  const r2 = (to >> 16) & 0xff;
  const g2 = (to >> 8) & 0xff;
  const b2 = to & 0xff;
  const r = Math.round(lerp(r1, r2, clamped));
  const g = Math.round(lerp(g1, g2, clamped));
  const b = Math.round(lerp(b1, b2, clamped));
  return (r << 16) | (g << 8) | b;
};

type ToneParams = {
  duration: number;
  frequency: number;
  volume: number;
  type: 'sine' | 'square' | 'saw';
};

type GlideParams = {
  duration: number;
  startFreq: number;
  endFreq: number;
  volume: number;
};

type ChordParams = {
  duration: number;
  frequencies: number[];
  volume: number;
};

type NoiseParams = {
  duration: number;
  volume: number;
};

type HumParams = {
  duration: number;
  volume: number;
};

const SAMPLE_RATE = 44100;

const makeTone = ({ duration, frequency, volume, type }: ToneParams) => {
  const samples = generateSamples(duration, (t) => {
    const angle = 2 * Math.PI * frequency * t;
    let wave = Math.sin(angle);
    if (type === 'square') {
      wave = Math.sign(wave);
    } else if (type === 'saw') {
      const period = 1 / frequency;
      wave = 2 * ((t % period) / period) - 1;
    }
    const env = envelope(t, duration, 0.02, 0.1);
    return wave * env * volume;
  });
  return samplesToWavData(samples, SAMPLE_RATE);
};

const makeGlide = ({ duration, startFreq, endFreq, volume }: GlideParams) => {
  const samples = generateSamples(duration, (t) => {
    const freq = lerp(startFreq, endFreq, t / duration);
    const angle = 2 * Math.PI * freq * t;
    const wave = Math.sin(angle);
    const env = envelope(t, duration, 0.02, 0.12);
    return wave * env * volume;
  });
  return samplesToWavData(samples, SAMPLE_RATE);
};

const makeChord = ({ duration, frequencies, volume }: ChordParams) => {
  const samples = generateSamples(duration, (t) => {
    let mix = 0;
    for (const freq of frequencies) {
      mix += Math.sin(2 * Math.PI * freq * t);
    }
    mix /= Math.max(1, frequencies.length);
    const env = envelope(t, duration, 0.03, 0.2);
    return mix * env * volume;
  });
  return samplesToWavData(samples, SAMPLE_RATE);
};

const makeNoise = ({ duration, volume }: NoiseParams) => {
  const samples = generateSamples(duration, (t) => {
    const env = envelope(t, duration, 0.01, 0.2);
    return (Math.random() * 2 - 1) * env * volume;
  });
  return samplesToWavData(samples, SAMPLE_RATE);
};

const makeEngineHum = ({ duration, volume }: HumParams) => {
  const samples = generateSamples(duration, (t) => {
    const base = Math.sin(2 * Math.PI * 110 * t);
    const overtone = Math.sin(2 * Math.PI * 220 * t) * 0.5;
    const env = envelope(t, duration, 0.03, 0.2);
    return (base + overtone) * env * volume;
  });
  return samplesToWavData(samples, SAMPLE_RATE);
};

const envelope = (t: number, duration: number, attack: number, release: number) => {
  const attackPhase = clamp(t / attack, 0, 1);
  const releasePhase = clamp((duration - t) / release, 0, 1);
  return Math.min(attackPhase, releasePhase);
};

const generateSamples = (duration: number, fn: (t: number) => number) => {
  const length = Math.floor(duration * SAMPLE_RATE);
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const t = i / SAMPLE_RATE;
    samples[i] = fn(t);
  }
  return samples;
};

const samplesToWavData = (samples: Float32Array, sampleRate: number) => {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const s = clamp(samples[i], -1, 1);
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
};

const writeString = (view: DataView, offset: number, value: string) => {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
};
