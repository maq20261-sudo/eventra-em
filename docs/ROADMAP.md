# GatherSpace — roadmap & status

What's done, what's next, and what is waiting on the owner. Every phase
needs the owner's explicit go-ahead before implementation (see `CLAUDE.md`).

_Last updated: 2026-10-11_

## Status at a glance

| Phase | State |
|---|---|
| Part A — local development (Docker, VS Code, dev build, accounts) | ✅ Done (`7bdc823`) |
| UI/UX redesign "Neon Night" + excitement features + brand assets | ✅ Done (`a064b6f`), tested by the owner on Android dev build |
| Part B — AWS production | ✅ Live 2026-10-11 at `https://api.gatherspace.in` (merged to `main`, deploys on push). Runs `658d363` with Razorpay **test** keys and `PAYMENTS_ENABLED=0` (KYC rejected). See `docs/DEPLOYMENT.md` → Current production setup |
| Part C — bug fixes | ⏳ After B (some may be pulled earlier) |
| Store release of the new app | 🔨 Next — production APK (EAS profile `production-apk`, versionCode 2) built 2026-10-11 and under owner test; then Play AAB + listing (see "Store release" below) |

## Decisions (2026-10-10)
- `main` becomes the real branch: PR the work into `main`; deploys run from `main`.
- `EVENT_VERIFICATION_ENABLED=false` at launch (no admin screen exists).
- Event images move to S3 as part of Part B.
- DNS for `gatherspace.in` is at **GoDaddy**.
- Part C #1 ("paid but no booking") fixed **before** launch — done in B1.

## Open actions for the owner
- [ ] Enable **Geocoding API** on the Google Cloud key (server fallback for area names).
- [x] `docs/DEPLOYMENT.md` steps 1–5, 7, 8 done 2026-10-11 (step 6 Razorpay live postponed).
- [x] Merge into `main` → first deploy (step 9); preview APK tested OK (2026-10-11).
- [x] Payments "coming soon" switch merged (PR #3) and `PAYMENTS_ENABLED=0` set on the server.
- [ ] Restrict the Firebase API keys in Google Cloud Console (Android/iOS app restrictions), then close GitHub secret-scanning alerts #1/#2 as "Won't fix"; close #3 (doc placeholder) as false positive.
- [ ] Optional: UptimeRobot monitor on `https://api.gatherspace.in/api/health`.
- [ ] Atlas: remove the temporary PC IP from Network Access when no longer needed.
- [x] Push `feat/neon-redesign` to GitHub (done 2026-10-10).
- [ ] **Razorpay live activation** — rejected 2026-10-11: "Individual" business type isn't supported for event ticketing. Ask Razorpay support whether a sole proprietorship (Udyam + current account, GST if needed) is accepted, else LLP/Pvt Ltd; then reapply. Until then production runs Razorpay **test** keys — decide before the store switch-over whether to wait or temporarily disable paid online flows.
- [ ] iOS: device registration failed during the first iOS build attempt (Apple ID / team step) — retry `npx eas-cli device:create` + build in the owner's PowerShell; note the exact error.
- [ ] Play Console → App integrity: confirm Play App Signing, then **request upload-key reset** with the EAS upload certificate (takes Google a few days — start early).
- [ ] Look up current store version codes (EAS remote counter is at **2**, almost certainly below Play's) (Play "App bundle explorer", App Store Connect) so new builds are higher (`npx eas-cli build:version:set`).

---

## Store release (next)

Open questions for the owner (answer at the start of the next session):
1. Play upload-key reset requested? (EAS keystore ≠ Emergent's upload key — Google takes a few days.)
2. Can Emergent's production database be exported, or do we launch with a fresh database?
3. Current privacy-policy URL — if Emergent-hosted, build simple `gatherspace.in` pages (privacy, terms, delete-account).
4. Current Play version code → `npx eas-cli build:version:set` above it.

Steps:
1. Owner tests the production APK (`eas build --profile production-apk -p android`) against production.
2. Add the Play **App signing** SHA-1/SHA-256 to Firebase (phone OTP in store builds).
3. `npx eas-cli build --profile production -p android` (AAB).
4. Store listing: 512 icon, feature graphic, **new designed screenshot set** (Neon Night UI; plan delivered — pending owner choices: language, headlines, capture via adb/USB vs manual, timing), description, Data safety form.
5. Internal testing track → staged production rollout.
6. iOS (after device/Apple ID issue is solved) → App Store.
7. When both stores are live on the new backend: shut down Emergent.

---

## Part B — AWS production (cheapest sensible setup, ~$8–14/month)

| Piece | Choice | Cost |
|---|---|---|
| Server | AWS **Lightsail**, Mumbai (ap-south-1), 1 GB plan, Docker Compose: backend + **Caddy** (automatic HTTPS) | ~$7/month, public IP + transfer included |
| Database | **MongoDB Atlas M0** (free, AWS Mumbai) | $0 (512 MB) |
| Images | **S3** bucket for event banners (replace base64-in-Mongo) | < $1/month |
| Backups | daily `mongodump` → S3 via cron (M0 has no automatic backups) | pennies |
| Domain | `api.gatherspace.in` (owner owns `gatherspace.in`) | existing |
| CI/CD | GitHub Actions → build image → GitHub Container Registry (GHCR) → SSH deploy to Lightsail | $0 |
| App builds | EAS free plan | $0 |

Why Lightsail, not EC2: fixed price with public IPv4 and transfer included (EC2 charges ~$3.60/month just for the IPv4). Deliberately avoided for cost: load balancer ($16+), ECS/Fargate ($15–30), DocumentDB (~$200), NAT gateway (~$32). Upgrade path: Lightsail 2 GB ($12) and Atlas Flex when traffic grows; a load balancer only if more than one server is needed.

### B1 — done on `feat/aws-production` (2026-10-10)
- `deploy/`: `docker-compose.prod.yml` (backend from GHCR + Caddy), `Caddyfile` (auto HTTPS, HSTS, 10 MB body), `setup-server.sh` (Docker, 2 GB swap, ufw, unattended upgrades, backup cron), `backup.sh` (nightly mongodump → S3), `backend.env.example`.
- `.github/workflows/backend.yml`: tests on every push/PR (Mongo service, no external keys) → on `main`: build → GHCR `ghcr.io/maq20261-sudo/gatherspace-backend:<sha>` → scp + SSH deploy → health smoke test (deploy gated by repo variable `DEPLOY_ENABLED=true`).
- Backend: `/api/health` (DB ping); legacy signup/MSG91 endpoints off in production (`ENABLE_LEGACY_AUTH`); `seed.py` refuses `APP_ENV=production`; blank Razorpay keys = unset; prod image runs 2 uvicorn workers with proxy headers; S3 cover images (`image_store.py`, migration `004_images_to_s3.py`).
- **Part C #1 fixed**: availability pre-check before creating the Razorpay order; idempotent `_fulfil_intent` (atomic claim; app verify and webhook can't double-apply); automatic refund when a paid booking/boost can't be completed; `POST /api/payments/webhook` (`payment.captured`, HMAC-verified) completes payments when the app never returns; orders request auto-capture.
- Tests: `test_payment_safety.py` (+6), Google/Razorpay-dependent tests skip without keys (CI). Local: 153 passed / 1 known; simulated CI: 135 passed / 22 skipped.

### Steps (original plan; 1, 4–7 implemented in B1)
1. **Production config in code**
   - `docker-compose.prod.yml`: backend (no reload, no debugpy, `INSTALL_DEV=0`, 2 uvicorn workers or gunicorn) + Caddy (`Caddyfile`: `api.gatherspace.in` → backend:8001, HSTS, gzip).
   - `APP_ENV=production`, `TRUST_X_FORWARDED_FOR=1`, `CORS_ORIGINS` set, `EVENT_VERIFICATION_ENABLED` decision, `DISABLE_RATE_LIMIT=0`.
   - Disable legacy `/auth/register` + MSG91 endpoints in production; guard `seed.py` from running with `APP_ENV=production` against a non-empty DB.
   - Health check endpoint (`GET /api/` exists; add `/api/health` with DB ping).
   - Fix: blank `RAZORPAY_KEY_*` treated as configured (`_RZP_CONFIGURED`).
2. **Accounts** (owner): AWS account + billing alarm ($15), Atlas org/project + M0 cluster in Mumbai + DB user + network access (Lightsail static IP), Razorpay **live** keys + KYC, DNS `A api.gatherspace.in → Lightsail static IP`.
3. **Server**: Lightsail Ubuntu 1 GB, static IP, firewall 22/80/443, 1–2 GB swap, Docker + compose, deploy user with SSH key, `.env` + Firebase admin key placed on the server (never in the image/repo).
4. **CI/CD**: GitHub Actions on push to `main`: run backend tests → build image → push to GHCR → SSH `docker compose pull && up -d` → smoke test `https://api.gatherspace.in/api/`.
5. **Images to S3**: bucket (ap-south-1, private + CloudFront or public-read prefix), presigned upload from the app or upload via API; migrate existing base64 images.
6. **Backups**: nightly `mongodump --uri $MONGO_URL | gzip` → S3 with 30-day lifecycle; test a restore once.
7. **Observability (cheap)**: Docker log rotation, UptimeRobot (free) on the health URL, Lightsail metric alarms.
8. **Switch-over from Emergent**
   1. Deploy AWS backend; verify with the `preview` profile APK.
   2. Production builds (`eas build --profile production`) pointing at `https://api.gatherspace.in`, version codes above the store's; Firebase: add Play **App signing** SHA-1/SHA-256 if missing.
   3. Submit to both stores (internal testing track first on Play).
   4. After both are approved and live, shut down the Emergent deployment.

---

## Part C — bug fixes (priority order)

| # | Issue | Where / notes | Proposed fix |
|---|---|---|---|
| 1 | ~~Paid but no booking~~ — **fixed in B1** (pre-check, idempotent fulfilment, auto-refund, webhook) | `_check_booking_availability`, `_fulfil_intent`, `/payments/webhook` | Remaining idea: short seat *holds* during checkout to avoid even the refund case |
| 2 | ~~OTP bypass via stale Firebase user~~ — **fixed 2026-10-14** (`fix/part-c-bugs`): server requires the typed mobile to match the token's phone and an OTP verified < 10 min ago (`_phone_claims`); app signs Firebase out on session expiry / after use and only reuses an auto-verified user for the same number | `_phone_claims`, `src/firebase.ts`, `otp.tsx`, `reset-password.tsx` | — |
| 3 | ~~Oversell (time slot, and any race with the self-heal)~~ — **fixed 2026-10-14**: bookings and releases for one event run under a short Mongo lock (`_event_inventory_lock`) and check `_booked_snapshot` (bookings collection) — no more counter-based guard | `_perform_booking`, `_check_booking_availability` | — |
| 4 | ~~Event deletion orphans bookings~~ — **fixed 2026-10-14**: DELETE refused (409) for an upcoming event with active bookings; new `POST /events/{id}/cancel` cancels + refunds every booking, hides the event, ticket shows "Event cancelled by the organizer" | `cancel_event`, `EventForm.tsx` (Cancel event) | Push notification to attendees once push exists |
| 5 | ~~Seat list not validated~~ — **fixed 2026-10-14**: seat ids checked against the grid (A–Z × cols), duplicates rejected; rows limited to 26 | `_validate_booking_request` | — |
| 6 | ~~Legacy signup endpoints~~ — **off in production** (B1, `ENABLE_LEGACY_AUTH`) | — | Remove the code later |
| 7 | ~~Base64 images in Mongo~~ — **S3 in B1** (run migration 004 in prod) | `image_store.py` | — |
| 8 | ~~`seed.py` wipes all bookings~~ — **refuses in production** (B1) | — | — |
| 9 | ~~Blank Razorpay keys counted as configured~~ — **fixed** (B1) | — | — |
| 10 | Minor — **mostly fixed 2026-10-14**: booked-seats GET is read-only; `num_seats` set on every booking; seat-map cancels free `booked_count`; cancel cutoff from `/pricing/config`; LogBox warnings on in dev; seat map shrinks to fit narrow phones (scrolls with a hint below 20 dp seats) | — | Left: ESLint resolver binding; light theme polish; `test_only_past_returns_only_ended_events` relies on old data; boost tests assume `PAYMENTS_ENABLED=1` |

## Web app — app.gatherspace.in (2026-10-14, branch `feat/web-app`)
For iPhone users until the App Store release. Same Expo codebase built for web, served by Caddy on the Lightsail box (₹0 extra), installable as a PWA.
- Done: web phone OTP (`src/firebase.web.ts`, Firebase JS SDK + invisible reCAPTCHA), browser dialogs for `Alert.alert` (`src/webAlert.ts`), phone-width frame on wide screens, PWA manifest + icons (`frontend/public/`), Caddy site + `web.yml` deploy, Caddy recreated by `backend.yml` when its config changes. API CORS already allows `https://*.gatherspace.in`.
- Verified locally in Edge (iPhone size): login, Discover, event, booking, My Tickets, organizer edit, delete/cancel dialogs.
- Owner steps: Firebase → add **Web app** + authorized domain `app.gatherspace.in`; restrict its API key to HTTP referrers; GitHub variables `FIREBASE_WEB_API_KEY` / `FIREBASE_WEB_APP_ID`; GoDaddy `A app → 65.2.231.136` **before** merging.
- To check after go-live: OTP sign-up/reset on iPhone Safari, ticket scanner (camera via jsQR) on iPhone, Add to Home Screen.

## Ideas parked for later
- Push notifications (booking reminders, new events nearby — Profile already has the preference toggles but nothing sends them).
- More built-in cover photos (only 4 defaults today) across categories.
- Saved/favourite events, share event link.
