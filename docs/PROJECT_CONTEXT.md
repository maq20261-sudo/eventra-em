# GatherSpace — project context

Single source of truth for "what is this project, how does it work, what has
been decided and done". Update the **History** section at the end of every
work session. Status and next steps live in `ROADMAP.md`.

_Last updated: 2026-10-10_

---

## 1. Product

Event discovery and booking for India (prices in ₹).

| Role | Can do |
|---|---|
| **Attendee** (`consumer`) | Discover events near a location within a radius; filter by category; search; view details + map; book (reserved seat map, general admission, or time slots); pay online (Razorpay) or reserve and pay at the venue; QR ticket; cancel up to 2 h before start (paid → automatic refund); profile, notifications prefs, dark/light theme |
| **Organizer** | Create/edit/delete events (cover image, start/end, location via Google Places + map pin, price, booking type, seat grid / showings / time-slot capacities); see status (In review / Active / On hold / Rejected + admin reasons); boost to Featured (paid); scan QR tickets, collect pay-at-venue money, confirm entry; analytics (revenue, tickets, check-ins, attendees, categories, top events) |

The same email can hold both an attendee and an organizer account (login asks "Which account?").

Store listings: Android `com.maq.gatherspace` (Play) and iOS bundle `com.maq.gatherspace` (App Store), both under the owner's developer accounts. Version 1.0.0 is live, built by Emergent.

## 2. Business rules (server is the source of truth)

| Rule | Value | Where |
|---|---|---|
| Attendee platform fee | ₹9 per paid booking | `PLATFORM_FEE_ATTENDEE_PAISE` |
| Attendee free tier | first 5 bookings without platform fee | `ATTENDEE_FREE_BOOKING_LIMIT` |
| Organizer publish fee | ₹19 per event after the free tier | `PLATFORM_FEE_ORGANIZER_PAISE` |
| Organizer free tier | first 5 events free | `ORGANIZER_FREE_EVENT_LIMIT` |
| Boost (Featured) | 1 day ₹9 · 7 days ₹49 · 30 days ₹99 | `FEATURE_TIERS` in `server.py`, exposed by `GET /api/pricing/config` → `boost_tiers` |
| Cancellation | allowed until 2 h before start; paid-online → Razorpay refund | `CANCEL_CUTOFF_HOURS` (frontend still hardcodes 2 h — backlog) |
| Event verification | when `EVENT_VERIFICATION_ENABLED=true`, new events start `IN_REVIEW`; statuses `ACTIVE`, `ON_HOLD`, `REJECTED` with `hold_reasons` | `migrations/003_event_status.py` |
| Payment methods | Razorpay online (UPI/cards/netbanking) or pay at venue; online hidden if gateway not configured | `/api/payments/*` |

The app must never hardcode amounts — read `/api/pricing/config` and `/api/quota/me` (a hardcoded boost price once showed ₹15 while Razorpay charged ₹299).

## 3. Architecture

### Frontend — `frontend/`
- Expo SDK 54, React Native 0.81.5 (New Architecture), expo-router 6, React 19.1, TypeScript.
- Native modules that require a **development build** (Expo Go cannot run the app): `@react-native-firebase/app|auth` (phone OTP), expo-camera (QR scan), expo-location, expo-image-picker, react-native-webview (Razorpay checkout + Leaflet maps), react-native-svg/qrcode.
- Routes (`app/`):
  - `(auth)/` welcome, login, register, otp, forgot-password, reset-password
  - `(consumer)/` discover, bookings ("My Tickets"), profile
  - `(organizer)/` events, create, scanner, analytics, profile (re-exports consumer profile), `edit/[id]`
  - `event/[id]`, `book/[id]` (incl. full-screen confirmation), `ticket/[id]`, `index` (role redirect)
- Key modules (`src/`): `api.ts` (fetch wrapper, base URL from `EXPO_PUBLIC_BACKEND_URL`), `AuthContext.tsx` (JWT + Firebase), `firebase.ts`, `ThemeContext.tsx` (palettes), `theme.ts` (spacing/radius/fonts/shadows), `EventForm.tsx` (create/edit), `RazorpayCheckout.tsx`, `EventMap.tsx` / `LocationPicker.tsx` (Leaflet in WebView, OSM tiles recoloured dark), `LocationSearchField.tsx` (Google Places via backend proxy), `hooks/usePricing.ts`, `utils/` (urgency, countdown, areaName, eventStatus, ticketLabel, eventTypeLabel, storage).
- Design-system components: `src/ui/` — `Text` (font-aware Text/TextInput), `Button`, `Tag`, `PressableScale`, `GlowBackground`, `Skeleton`, `EmptyState`, `Confetti`, `NeonTabBar`, `motion.ts` (`softPop`).
- OTA updates: `expo-updates`, runtime policy `appVersion`, URL `https://u.expo.dev/fc1b7265-9d57-4f91-ad33-98518f8b489a`, channels from `eas.json` (development / preview / production).
- EAS project owner `maq2026s-team`, project id `fc1b7265-9d57-4f91-ad33-98518f8b489a`. Profiles: `development` (dev client, internal), `preview` (internal APK → `https://api.gatherspace.in`), `production` (store, auto-increment → `https://api.gatherspace.in`).

### Backend — `backend/`
- FastAPI 0.110 + Motor/MongoDB, single `server.py` (~3 k lines), `firebase_admin_util.py` (verifies Firebase ID tokens; `FIREBASE_DEV_BYPASS=1` mocks it for tests), `msg91_client.py` (legacy SMS OTP, mock mode), `seed.py` (demo data — **wipes all bookings, never run in production**), `migrations/001-003`.
- Auth: JWT (`JWT_SECRET_KEY`, 7-day tokens, `token_version` for logout-all), bcrypt passwords. Signup = Firebase phone OTP (`/auth/register/start|verify`, `/auth/firebase-verify`), login = email + password, password reset via phone OTP. Legacy `/auth/register` and MSG91 endpoints still exist (backlog: disable).
- Mongo collections: `users`, `events`, `bookings`, `otp_challenges`, `payment_intents`.
- Payments: Razorpay order (`/payments/order`, kinds `booking` | `boost` | `platform_fee` (organizer publish fee)) → client checkout → `/payments/verify` (HMAC) → booking/boost applied. No webhook yet (backlog #1).
- Google APIs (server-side key `GOOGLE_MAPS_API_KEY`): Places autocomplete/details proxy, reverse geocode (`/places/reverse` returns `formatted_address, name, area, city`). **Geocoding API is not yet enabled on the owner's key.**
- Rate limiting: in-memory per IP; behind a proxy set `TRUST_X_FORWARDED_FOR=1`.
- API routes (all under `/api`): auth (register/login/start/verify/otp resend/firebase-verify/password-reset/me/logout), places (autocomplete/details/reverse), events (CRUD, list with geo radius + category + search, booked-seats, organizer/events, feature-tiers, feature), bookings (create, me, cancel), checkin (preview, confirm), pricing/config, quota/me, payments (config/order/verify), analytics/organizer, `GET /api/` health.
- Environment variables: `APP_ENV`, `MONGO_URL`, `DB_NAME`, `JWT_SECRET_KEY`, `CORS_ORIGINS`, `CORS_ORIGIN_REGEX`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` (leave unset, not blank — blank counts as configured, backlog), `GOOGLE_MAPS_API_KEY`, `FIREBASE_ADMIN_JSON_PATH`, `FIREBASE_DEV_BYPASS`, `MSG91_*`, `EVENT_VERIFICATION_ENABLED`, `TRUST_X_FORWARDED_FOR`, `DISABLE_RATE_LIMIT`, fee/limit overrides, `CANCEL_CUTOFF_HOURS`, `SEED_DEMO_PASSWORD`. Template: `backend/.env.example`.

### Local development (Part A — done)
- Windows 10 + Rancher Desktop (dockerd/moby, Kubernetes off, WSL2) + Docker Compose; Node 24 LTS; Python 3.11 venv at `backend/.venv` (IntelliSense + local pytest); VS Code with recommended extensions.
- `docker-compose.yml`: `mongo` (127.0.0.1:27017), `backend` (8001, hot reload via polling, debugpy 127.0.0.1:5678), profile `test` (`backend-test` on 127.0.0.1:8002 with `gatherspace_test` DB + mocks, `tests` runner), profile `tools` (mongo-express on 127.0.0.1:8082).
- Phone reaches the PC at `http://<PC Wi-Fi IP>:8001` (`frontend/.env`), Windows Firewall rule "GatherSpace dev (API 8001, Metro 8081)".
- VS Code: `.vscode/launch.json` (Backend: Attach (Docker), Frontend: Attach (Expo)), `tasks.json` (Start stack, Backend logs, Metro, tests, typecheck, lint), Testing panel uses `.vscode/pytest.env` → backend-test.

## 4. Accounts & external services

| Service | Status / identifier |
|---|---|
| GitHub | `maq20261-sudo/eventra-em` (remote `origin`). `main` is stale (79 commits behind the real line of work). |
| Firebase | project `gatherspace-541ac` (owner has console access). Admin key at `backend/credentials/firebase-admin.json` (git-ignored). Dev-build SHA-1/SHA-256 added to the Android app. |
| Expo / EAS | account/team `maq2026s-team`, new project (Emergent's EAS project is not accessible). |
| Razorpay | test keys in `backend/.env`. Live keys needed for production. |
| Google Cloud | Maps key in `backend/.env` (Places API enabled; **Geocoding API to enable**). |
| MongoDB Atlas | M0 chosen for production — not created yet. |
| AWS | Lightsail Mumbai chosen — not created yet. |
| Domain | `gatherspace.in` (owner's). API will be `api.gatherspace.in`. Support email `support@gatherspace.in`. |
| Play Console | Play App Signing status to confirm; **upload key reset needed** (new EAS keystore). |
| Apple | certificates will be regenerated by EAS. |

## 5. Design system — "Neon Night" (approved 2026-10-10)

- Dark-first. Colours (`src/ThemeContext.tsx` `DARK_COLORS`): background `#0D0B1A`, cards `#1A1630`, raised `#1E1838`, border `#2C2550`, text `#F5F3FF`, muted `#A39DC0`, soft `#CFC9EA`, **pink `#FF3D8B`** (primary; text on it `#14061D`), pink text `#FF6FA8`, violet `#7C5CFF`, **lime `#C6FF3D`** (highlights/success), warning `#FFB547`, error `#FF6B6B`, sheet `#15122A`. A light palette exists (Profile switch) but is not polished.
- Fonts: Unbounded (display/headings) + Manrope (body), loaded in `src/hooks/use-icon-fonts.ts`.
- Signature elements: pink/violet radial glows behind screens, pink glow under featured cards, floating rounded tab bar, round category bubbles (7 categories with their own colours), lime "FEATURED" tags, ticket-stub cards with notches.
- "Excitement" layer: press-spring on cards/buttons, list slide-ins, skeleton loaders, auto-sliding featured carousel, scanner scan line, analytics count-ups; urgency/social proof (`src/utils/urgency.ts`: "Only N left", "Selling fast", "Sold out", "N going"; `countdown.ts`: "Starts in 3 h"); full-screen confetti + haptic on booking confirmed and check-in; friendly animated empty states. Entrance pops must stay **subtle** (`softPop`, 96 → 100 % scale, no bounce) — owner feedback.
- Owner preferences learned during design: premium = restrained colour, fewer badges, generous spacing; dislikes busy/"over" screens and stretched mockups; background should feel lit (glows), not flat black.
- Brand assets generated by `frontend/assets/images/generate_assets.py` (pink Unbounded "G" + lime spark on the night background): icon, adaptive icon (bg `#0D0B1A`), splash, favicon, notification icon, Play feature graphic. Visible only after a new EAS build.
- Design canvas with all approved screens: claude.ai artifact "GatherSpace — Neon Night (all screens)" (`https://claude.ai/artifact/SenP4NAtrZWNLomUccVd9s`, private to the owner).

## 6. Location handling
- Discover location = GPS (or Mumbai default) + radius chips (5/10/25/50/100 km), saved in AsyncStorage (`gs_location`, `gs_radius`).
- Area names via `src/utils/areaName.ts`: on-device cache (`gs_geocode_cache_v1`, ≈1 km cells for area labels, ≈110 m for organizer addresses) → phone geocoder (free) → server Google reverse geocode (paid) last.
- Auto re-label when the phone moved ≥ 5 km (last known position, checked at most every 10 min on focus/foreground, never prompts).

## 7. History (what was done)

| Date | Work | Commit |
|---|---|---|
| 2026-10-09 | Full code exploration; confirmed **no runtime dependency on Emergent** (only build tooling) → no rebuild needed. Decided to start fresh with all secrets/accounts (no valuable user data). | — |
| 2026-10-09 | **Part A — local dev**: removed Emergent artifacts (`.emergent/`, agent `.gitconfig`, cmd-guard scripts, preinstall hook); Dockerfile + compose + test profile; `.env.example`s; npm instead of Yarn; expo-dev-client; EAS project + `eas.json`; app.json cleanup (updates URL, RECORD_AUDIO removed); test fixes (paths, base URLs, seed status); README. Installed WSL2, Rancher Desktop, Node 24. Firebase Admin key, Razorpay test keys, Maps key, firewall, first Android dev build + SHA fingerprints — phone OTP works end-to-end. | `7bdc823` |
| 2026-10-10 | VS Code setup: debugpy in backend container, launch/tasks/settings, Python 3.11 venv, Testing panel against isolated test server. | `7bdc823` |
| 2026-10-10 | **UI/UX redesign**: explored ~15 themes on a design canvas; owner chose "Neon Night" (design 1); full screen set designed then implemented across all attendee, organizer and auth screens + excitement layer + new icon/splash. | `a064b6f` |
| 2026-10-10 | Fixes found while testing: boost price mismatch (app ₹15 vs charged ₹299 — pre-existing) → server-driven `boost_tiers`, prices set to ₹9/49/99 + test; garbled ₹ characters; Android shadow artefact; "no platform fee" banner copy; real area name instead of "Your current location" with geocode caching + auto-refresh; support email → `.in`; softer entrance animations. | `a064b6f` |

Branches: `chore/decouple-emergent` (Part A, pushed) → `feat/neon-redesign` (redesign, **not pushed**). Both are ahead of the stale `main`.
