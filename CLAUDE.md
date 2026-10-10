# GatherSpace — read me first (Claude Code session guide)

GatherSpace is a live event discovery + booking app (India, ₹). Attendees find
nearby events and book (seat map / general / time slots, pay online via
Razorpay or at the venue, QR ticket). Organizers create events, boost them,
scan tickets at the gate and see analytics. It was originally generated on the
Emergent AI platform; it is now fully decoupled and developed locally.

**Before doing anything, read:**
1. `docs/PROJECT_CONTEXT.md` — architecture, features, business rules, accounts, design system, history of what was done and why.
2. `docs/ROADMAP.md` — current status, next phases (Part B AWS, Part C bug fixes) with step-by-step plans, open user actions.

## Working agreement with the owner (must follow)
- **Plan first, wait for explicit approval before implementing each phase/feature.** Explaining, investigating and proposing are fine; writing code for a new phase is not, until the owner says go.
- **Never commit, push, deploy or open PRs unless asked.** Branch before committing if on `main`.
- Show designs/plans visually when useful (the owner reviews UI on a design canvas before coding).
- Report outcomes honestly: test counts, what was and wasn't verified on a device.
- The owner tests on a real Android phone (dev build) and an iPhone; Windows 10 PC.

## Repo layout
- `frontend/` — Expo SDK 54 / React Native 0.81 app (expo-router). npm (not Yarn).
- `backend/` — FastAPI + MongoDB (Motor), single `server.py`; tests in `backend/tests`.
- `docker-compose.yml` — local stack (mongo + backend with hot reload + debugger, isolated test profile).
- `.vscode/` — launch/tasks/settings for VS Code (debug backend in Docker, Metro, tests).
- `docs/` — project context + roadmap (keep these updated at the end of each work session).

## Everyday commands (Windows, from repo root)
```powershell
docker compose up -d                                 # mongo + API on :8001 (debugpy on 127.0.0.1:5678)
docker compose exec backend python seed.py           # demo data — LOCAL ONLY, wipes all bookings
docker compose --profile test run --rm tests         # backend tests (isolated gatherspace_test DB)
cd frontend; npx expo start --dev-client -c          # Metro for the phone dev build
cd frontend; npx tsc --noEmit -p .                   # typecheck (must be clean)
```
Demo logins (local): `demo@organizer.com` / `demo@consumer.com`, password `password123`.
Expected test baseline: all pass except `test_only_past_returns_only_ended_events` (needs Emergent's old data).

## Environment gotchas (learned the hard way)
- Tool shells may lack PATH entries: prepend `C:\Program Files\nodejs` and `C:\Program Files\Rancher Desktop\resources\resources\win32\bin` (docker).
- **Never edit files with PowerShell `Get-Content`/`Set-Content`** (Windows PowerShell 5.1 re-encodes UTF-8 → garbles ₹ — · ×). Use the Edit/Write tools, `[IO.File]::ReadAllText/WriteAllText`, or node.
- In VS Code tasks use `npx.cmd`/`npm.cmd` (PowerShell execution policy blocks `npx.ps1`).
- Use `127.0.0.1`, not `localhost`, for local HTTP from Windows (IPv6 fallback makes tests ~10× slower).
- `backend/.env`, `backend/credentials/firebase-admin.json`, `frontend/.env` are git-ignored secrets — never print or commit them.
- ESLint currently fails to start (missing `unrs-resolver` native binding — npm optional-deps bug); rely on `tsc` + `npx expo export` until fixed.
- Native changes (icon, splash, new native modules, app.json plugins) need a new EAS build; JS changes only need Metro.

## Frontend conventions
- Colours only from `useTheme().colors` (`src/ThemeContext.tsx`); fonts via `src/ui/Text` (`Text`/`TextInput` wrappers map `fontWeight` → Manrope; `fontFamily: fonts.display` → Unbounded).
- Reuse `src/ui/*` (Button, Tag, PressableScale, GlowBackground, Skeleton, EmptyState, Confetti, NeonTabBar, `softPop` motion).
- Prices/fees/boost tiers come from the server (`GET /api/pricing/config`, `/api/quota/me`) — never hardcode amounts.
- Reverse geocoding: always via `src/utils/areaName.ts` (on-device cache → phone geocoder → paid server API last).
