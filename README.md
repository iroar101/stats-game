# Rocket Ride (Crash-style)

Arcade crash-style multiplier game built with Vite + TypeScript + PixiJS. The rocket climbs, multiplier rises, and you cash out before the crash.

## Run

```bash
npm install
npm run dev
```

## Cisco Outshift QRNG API key

Create a file named `.env.local` in the project root and paste your key like this:

```
VITE_OUTSHIFT_API_KEY=your_key_here
```

Restart `npm run dev` after adding the key. The dev server proxies `/api/qrng` and injects the key server-side to avoid CORS errors.

## How it works

- Cost to play: $10
- Cash out at multiplier m => payout = $10 * m
- If crash happens first => payout = $0
- Cap multiplier at 25.00x

Crash multiplier math:

```
h = 0.06
U = (R + 1) / 65536
M = min(25, (1 - h) / U)
```

QRNG fetch comes from Cisco Outshift, with a local crypto fallback if the request fails.
