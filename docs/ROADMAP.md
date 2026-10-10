# GatherSpace — roadmap & status

What's done, what's next, and what is waiting on the owner. Every phase
needs the owner's explicit go-ahead before implementation (see `CLAUDE.md`).

_Last updated: 2026-10-10_

## Status at a glance

| Phase | State |
|---|---|
| Part A — local development (Docker, VS Code, dev build, accounts) | ✅ Done (`7bdc823`) |
| UI/UX redesign "Neon Night" + excitement features + brand assets | ✅ Done (`a064b6f`), tested by the owner on Android dev build |
| Part B — AWS production | ⏳ Next — plan below, not started |
| Part C — bug fixes | ⏳ After B (some may be pulled earlier) |
| Store release of the new app | ⏳ After B |

## Open actions for the owner
- [ ] Enable **Geocoding API** on the Google Cloud key (server fallback for area names).
- [ ] Decide `main` strategy: PR `feat/neon-redesign` (contains `chore/decouple-emergent`) into `main` and make `main` the deploy branch.
- [ ] Push `feat/neon-redesign` to GitHub.
- [ ] New EAS **development build** to see the new icon/splash (`npx eas-cli build --profile development --platform android`).
- [ ] iOS: `npx eas-cli device:create` on the iPhone, then an iOS dev build.
- [ ] Play Console → App integrity: confirm Play App Signing, then **request upload-key reset** with the EAS upload certificate (takes Google a few days — start early).
- [ ] Look up current store version codes (Play "App bundle explorer", App Store Connect) so new builds are higher (`npx eas-cli build:version:set`).

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

### Steps (proposed)
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
| 1 | **Paid but no booking**: Razorpay captures money, then `verify_payment` → `_perform_booking` can fail (e.g. 409 seat taken) with no refund | `server.py` `verify_payment` / `_perform_booking` | Reserve inventory before order creation (hold with expiry) or auto-refund on failure; add Razorpay **webhook** (`payment.captured`) as source of truth; idempotent `payment_intents` |
| 2 | **OTP bypass via stale Firebase user**: when the JWT expires `AuthContext.refresh` clears the token but not Firebase `currentUser`; `verifyOtp` / `otp.tsx` `onAuthStateChanged` can reuse the old user/phone | `src/AuthContext.tsx`, `src/firebase.ts`, `app/(auth)/otp.tsx` | `firebaseSignOut()` on logout/refresh failure; verify the phone of the confirmed credential matches the requested phone; server checks the ID token's phone |
| 3 | **Time-slot oversell**: aggregate-then-`$inc` is not atomic | `_perform_booking` time-slot branch | Atomic conditional update per slot (`$expr` booked + n ≤ capacity) like the general-admission path |
| 4 | **Event deletion orphans bookings**, no refunds | `DELETE /events/{id}` | Block deletion with active bookings, or cancel + refund all and notify |
| 5 | **Seat list not validated** (duplicates, out-of-grid seats) | `BookingCreate` / `_perform_booking` | Validate seat ids against rows/cols, dedupe |
| 6 | **Legacy signup endpoints** bypass phone verification | `/auth/register`, MSG91 endpoints | Disable in production (feature flag) and remove later |
| 7 | **Base64 images in Mongo**, returned in list responses | `image_url` | Move to S3 (Part B step 5) |
| 8 | `seed.py` wipes all bookings | `seed.py` | Refuse to run in production |
| 9 | Blank Razorpay keys counted as configured | `_RZP_CONFIGURED` | Treat empty strings as unset |
| 10 | Minor | — | GET booked-seats writes to DB; `BookingOut.num_seats` null; frontend hardcodes 2 h cancel cutoff (read from server); `LogBox.ignoreAllLogs`; ESLint resolver binding; light theme polish; `test_only_past_returns_only_ended_events` relies on old data |

## Ideas parked for later
- Push notifications (booking reminders, new events nearby — Profile already has the preference toggles but nothing sends them).
- More built-in cover photos (only 4 defaults today) across categories.
- Saved/favourite events, share event link.
