import { HOUSE_EDGE, MAX_MULTIPLIER } from './state';

const QRNG_URL = import.meta.env.VITE_QRNG_URL ?? '/api/qrng';
const SHOULD_USE_QRNG = import.meta.env.DEV || Boolean(import.meta.env.VITE_QRNG_URL);
const QRNG_BODY = {
  encoding: 'base64',
  format: 'decimal',
  bits_per_block: 16,
  number_of_blocks: 1
};
const MAX_UINT16 = 65535;
type OutshiftEncoding = 'base64' | 'raw';
type RandomNumberField = {
  binary?: string | null;
  octal?: string | null;
  decimal?: string | null;
  hexadecimal?: string | null;
};
type RandomNumberResp = {
  encoding?: OutshiftEncoding;
  random_numbers?: RandomNumberField[];
};

export class RNG {
  public isQuantum = false;

  async getUint16(): Promise<number> {
    if (!SHOULD_USE_QRNG) {
      this.isQuantum = false;
      const fallback = new Uint16Array(1);
      crypto.getRandomValues(fallback);
      return fallback[0];
    }
    try {
      const response = await fetch(QRNG_URL, {
        method: 'POST',
        cache: 'no-store',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(QRNG_BODY)
      });
      if (!response.ok) {
        throw new Error('QRNG fetch failed');
      }
      const data = (await response.json()) as RandomNumberResp;
      const value = readOutshiftNumber(data);
      if (value === null) {
        throw new Error('QRNG response invalid');
      }
      this.isQuantum = true;
      return clampUint16(value);
    } catch {
      this.isQuantum = false;
      const fallback = new Uint16Array(1);
      crypto.getRandomValues(fallback);
      return fallback[0];
    }
  }

  async getCrashMultiplier(): Promise<number> {
    const r = await this.getUint16();
    const u = (r + 1) / 65536;
    return Math.min(MAX_MULTIPLIER, (1 - HOUSE_EDGE) / u);
  }
}

const clampUint16 = (value: number) => {
  const rounded = Math.round(value);
  if (Number.isNaN(rounded)) {
    return 0;
  }
  if (rounded < 0) {
    return 0;
  }
  if (rounded > MAX_UINT16) {
    return rounded % (MAX_UINT16 + 1);
  }
  return rounded;
};

const readOutshiftNumber = (payload: RandomNumberResp): number | null => {
  const entry = payload.random_numbers?.[0];
  if (!entry) {
    return null;
  }

  const encoding = payload.encoding ?? 'base64';
  const decimal = decodeValue(entry.decimal, encoding);
  if (decimal !== null) {
    const parsed = parseInt(decimal, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  const hexadecimal = decodeValue(entry.hexadecimal, encoding);
  if (hexadecimal !== null) {
    const parsed = parseInt(hexadecimal, 16);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  const binary = decodeValue(entry.binary, encoding);
  if (binary !== null) {
    const parsed = parseInt(binary, 2);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  const octal = decodeValue(entry.octal, encoding);
  if (octal !== null) {
    const parsed = parseInt(octal, 8);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
};

const decodeValue = (value: string | null | undefined, encoding: OutshiftEncoding) => {
  if (!value) {
    return null;
  }
  if (encoding === 'raw') {
    return value.trim();
  }
  try {
    return atob(value).trim();
  } catch {
    return null;
  }
};
