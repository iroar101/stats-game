import * as PIXI from 'pixi.js';

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface Particle {
  sprite: PIXI.Sprite;
  age: number;
  life: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  startScaleX: number;
  startScaleY: number;
  endScaleX: number;
  endScaleY: number;
  startAlpha: number;
  endAlpha: number;
  rotationSpeed: number;
}

export class ParticleSystem {
  private pool: Particle[] = [];
  private active: Particle[] = [];

  constructor(private container: PIXI.Container, max: number) {
    for (let i = 0; i < max; i += 1) {
      const sprite = new PIXI.Sprite(PIXI.Texture.WHITE);
      sprite.anchor.set(0.5);
      sprite.visible = false;
      sprite.alpha = 0;
      this.container.addChild(sprite);
      this.pool.push({
        sprite,
        age: 0,
        life: 0,
        vx: 0,
        vy: 0,
        ax: 0,
        ay: 0,
        startScaleX: 1,
        startScaleY: 1,
        endScaleX: 1,
        endScaleY: 1,
        startAlpha: 1,
        endAlpha: 0,
        rotationSpeed: 0
      });
    }
  }

  spawn(
    x: number,
    y: number,
    vx: number,
    vy: number,
    ax: number,
    ay: number,
    life: number,
    tint: number,
    startScaleX: number,
    startScaleY: number,
    endScaleX: number,
    endScaleY: number,
    startAlpha: number,
    endAlpha: number,
    rotation: number,
    rotationSpeed: number
  ) {
    const particle = this.pool.pop();
    if (!particle) {
      return;
    }

    particle.age = 0;
    particle.life = life;
    particle.vx = vx;
    particle.vy = vy;
    particle.ax = ax;
    particle.ay = ay;
    particle.startScaleX = startScaleX;
    particle.startScaleY = startScaleY;
    particle.endScaleX = endScaleX;
    particle.endScaleY = endScaleY;
    particle.startAlpha = startAlpha;
    particle.endAlpha = endAlpha;
    particle.rotationSpeed = rotationSpeed;

    const sprite = particle.sprite;
    sprite.visible = true;
    sprite.tint = tint;
    sprite.x = x;
    sprite.y = y;
    sprite.rotation = rotation;
    sprite.alpha = startAlpha;
    sprite.scale.set(startScaleX, startScaleY);

    this.active.push(particle);
  }

  update(dt: number) {
    for (let i = 0; i < this.active.length; ) {
      const particle = this.active[i];
      particle.age += dt;
      if (particle.age >= particle.life) {
        particle.sprite.visible = false;
        particle.sprite.alpha = 0;
        this.pool.push(particle);
        this.active[i] = this.active[this.active.length - 1];
        this.active.pop();
        continue;
      }

      particle.vx += particle.ax * dt;
      particle.vy += particle.ay * dt;

      const sprite = particle.sprite;
      sprite.x += particle.vx * dt;
      sprite.y += particle.vy * dt;
      sprite.rotation += particle.rotationSpeed * dt;

      const t = particle.age / particle.life;
      sprite.alpha = lerp(particle.startAlpha, particle.endAlpha, t);
      sprite.scale.set(
        lerp(particle.startScaleX, particle.endScaleX, t),
        lerp(particle.startScaleY, particle.endScaleY, t)
      );

      i += 1;
    }
  }

  clear() {
    for (let i = 0; i < this.active.length; i += 1) {
      const particle = this.active[i];
      particle.sprite.visible = false;
      particle.sprite.alpha = 0;
      this.pool.push(particle);
    }
    this.active.length = 0;
  }
}

export class ScreenShake {
  public offsetX = 0;
  public offsetY = 0;
  private timeLeft = 0;
  private duration = 0;
  private amplitude = 0;

  start(amplitude: number, duration: number) {
    this.amplitude = amplitude;
    this.duration = duration;
    this.timeLeft = duration;
  }

  update(dt: number) {
    if (this.timeLeft <= 0) {
      this.offsetX = 0;
      this.offsetY = 0;
      return;
    }

    this.timeLeft -= dt;
    const t = clamp(this.timeLeft / this.duration, 0, 1);
    const strength = this.amplitude * t;
    const angle = Math.random() * Math.PI * 2;
    this.offsetX = Math.cos(angle) * strength;
    this.offsetY = Math.sin(angle) * strength;
  }
}

export class FlashPulse {
  public alpha = 0;
  private duration = 0;
  private elapsed = 0;
  private maxAlpha = 0;

  trigger(maxAlpha: number, duration: number) {
    this.maxAlpha = maxAlpha;
    this.duration = duration;
    this.elapsed = 0;
    this.alpha = maxAlpha;
  }

  update(dt: number) {
    if (this.duration <= 0) {
      this.alpha = 0;
      return;
    }

    this.elapsed += dt;
    const t = clamp(this.elapsed / this.duration, 0, 1);
    this.alpha = this.maxAlpha * (1 - t);

    if (t >= 1) {
      this.duration = 0;
      this.alpha = 0;
    }
  }
}
