# SarthiSync Live

SarthiSync Live is a full-stack transportation management app converted from the original single-page demo.

## What changed

- Added backend API with server-side persistence (`data.json`)
- Added cookie-based session auth
- Protected all business endpoints behind login
- Rebuilt frontend to consume live APIs instead of direct `localStorage`
- Preserved core workflows: vehicles, drivers, routes, assignments, status tracking, search, analytics, CSV export, reset, dark mode
- Added live fleet map with playback timeline
- Added AI Dispatch Copilot for route-aware vehicle/driver recommendations
- Live map behavior: only assignments are tracked; `Pending` stays at source, `In Transit` moves, `Delivered` stays at destination
- Added real-world delivery operations:
  - consignment intake (LR/GR, customer, material, weight, ETA)
  - pickup/drop OTP verification
  - ePOD capture (receiver, signature, photo URL, GPS)
  - invoice generation (base, toll, fuel surcharge, waiting, tax)
  - exception logging for delayed/damaged/partial/failed delivery

## Tech

- Node.js built-in HTTP server (no external backend framework)
- Vanilla JavaScript frontend + Bootstrap + Chart.js
- JSON file persistence

## Run locally

1. Open terminal in `sarthisync-live`.
2. Start server:

```bash
node server.js
```

Or if you want npm scripts:

```bash
npm start
```

3. Open: `http://localhost:3001`

## Deploy (Render)

1. Push `sarthisync-live` to a GitHub repo.
2. In Render, create a new `Blueprint` deploy using `render.yaml`.
3. Deploy and copy the generated app URL.
4. Update portfolio links (`agam-portfolio's/index.html` and `agam-portfolio's/case-studies/sarthisync.html`) from `http://localhost:3001` to your Render URL.

## Deploy (Vercel)

This repo now includes:

- `vercel.json` to route all requests through serverless function
- `api/index.js` as Vercel entrypoint
- server compatibility updates for serverless runtime

### 1) Push to GitHub

Push the `sarthisync-live` folder to a GitHub repository.

### 2) Import project in Vercel

1. Open Vercel dashboard -> `Add New` -> `Project`
2. Import your repository
3. Set `Root Directory` to `sarthisync-live`
4. Framework preset: `Other`
5. Install command: `npm install`
6. Build command: leave empty (or set to `echo "No build step"`)
7. Output directory: leave empty

### 3) Environment variables

Set these in Vercel project settings:

- `SESSION_SECRET` = a long random secret (required for cookie session signing)

Optional:

- `DATA_FILE` to override storage path (default on Vercel is `/tmp/sarthisync-data.json`)

### 4) Deploy

Click `Deploy`.  
After deployment, open:

- `/api/health` to confirm API status
- app URL to login and test flows

### 5) CLI deploy (optional)

```bash
cd sarthisync-live
npx vercel login
npx vercel link
npx vercel --prod
```

### Important runtime note

On Vercel, local file storage uses `/tmp`, which is ephemeral in serverless environments.  
That means this setup is suitable for live demo/portfolio usage, not persistent production data.

For production-grade persistence, move data from JSON file to a managed database (for example: Supabase/Neon/Postgres).

## Demo credentials

- Username: `Agam`
- Password: `5280`

## API overview

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET,POST /api/vehicles`
- `GET,POST /api/drivers`
- `GET,POST /api/routes`
- `GET,POST /api/consignments`
- `POST /api/consignments/:id/otp/verify`
- `POST /api/consignments/:id/pod`
- `POST /api/consignments/:id/invoice`
- `POST /api/consignments/:id/exception`
- `GET,POST /api/assignments`
- `PATCH /api/assignments/:id/status`
- `DELETE /api/assignments/:id`
- `GET /api/fleet/live`
- `POST /api/copilot/recommendation`
- `POST /api/reset`
- `GET /api/health`
