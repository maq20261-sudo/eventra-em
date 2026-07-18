# GatherSpace — Event Management App

## Overview
Mobile-first event management app with two user roles: **Consumers** discover and book events, **Organizers** create, manage, boost, and check in attendees. Real-time seat/slot booking, QR ticket check-in, and **Razorpay** payments for both event bookings and Featured/Boosted event tiers.

## Tech Stack
- Frontend: Expo (React Native) SDK 54, expo-router, expo-location, expo-image, expo-camera, react-native-qrcode-svg, react-native-webview
- Backend: FastAPI + Motor (async MongoDB) + razorpay Python SDK
- Auth: JWT (email/password) with bcrypt; token stored in SecureStore
- Payments: **Razorpay** (test-mode) — server creates orders, verifies HMAC-SHA256 signatures, only marks bookings/boosts as paid after signature check passes

## Features

### Auth
- Register/Login with role selection (Attendee / Organizer)
- JWT token stored securely; auto sign-in on app open
- Demo accounts seeded

### Consumer (Attendee)
- **Discover**: Geo-based feed with radius filter (5-100 km), category chips, search. Featured/boosted events surface at the top with an amber flame badge.
- **Location**: GPS via expo-location OR default; radius persisted
- **Event Detail**: Hero image, description, organizer info, sticky Book CTA
- **Booking flows** (3 types): Seat map, General, Time slots
- **Pay & Confirm** for priced events routes through Razorpay checkout (native WebView + web-SDK fallback). Free events skip payment.
- **Pay-at-venue fallback**: If Razorpay keys aren't configured on backend, booking falls back to a "pay at venue" confirmation flow automatically.
- **QR Ticket**: Each confirmed booking generates a scannable QR. "Paid online" badge shown for paid tickets; "Pay $X at venue" for unpaid.
- **My Tickets**: Upcoming / Completed
- **Profile**: Notification toggles, Privacy statement, FAQ, About — no placeholder rows

### Organizer
- **Events list**: Sold/capacity progress bars, Boost + Edit per-event buttons
- **Create/Update Event**: Full form with category, image picker, date/time, GPS location, price, booking-type-specific settings
- **Boost / Featured tier**: 3 tiers ($4.99 / $14.99 / $39.99). Real Razorpay checkout when configured; auto-falls-back to simulated boost if not.
- **QR Scanner**: `expo-camera` scanner reads consumer QR, calls `/api/checkin`. Result shows attendee name, seats/slots, and either "Paid online" pill or "Collect $X at venue" reminder based on `payment_status`.
- **Analytics**: KPIs (Revenue, Tickets Sold, Checked In, Events, Attendees), category breakdown bars, top events by revenue

## API
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET/POST/PUT/DELETE /api/events`, `GET /api/events/{id}`, `GET /api/events/{id}/booked-seats`
- `GET /api/organizer/events`
- `GET /api/events/{id}/feature-tiers`, `POST /api/events/{id}/feature`
- `POST /api/bookings`, `GET /api/bookings/me`, `POST /api/bookings/{id}/cancel`
- `POST /api/checkin` (organizer)
- **Payments**:
  - `GET /api/payments/config` — returns provider, key_id, `configured` flag, currency, USD→INR rate
  - `POST /api/payments/order` — creates Razorpay order for `kind=booking` or `kind=boost`
  - `POST /api/payments/verify` — HMAC-SHA256 verification, executes the pending intent, idempotent
- `GET /api/analytics/organizer`

## Environment
`/app/backend/.env`
```
MONGO_URL=mongodb://localhost:27017
DB_NAME=test_database
JWT_SECRET_KEY=…
RAZORPAY_KEY_ID=rzp_test_…
RAZORPAY_KEY_SECRET=…
```

## Testing
- **61 / 61 backend tests pass** (50 core + 11 Razorpay payment tests including HMAC signature verify, idempotency, RBAC, bad-signature rejection, boost featured-marking)
- Frontend flows verified via screenshots: Discover → Book → Razorpay checkout (₹3735, real Razorpay test UI opens with GatherSpace branding)

## Demo Credentials
See `/app/memory/test_credentials.md`.

## Razorpay Test Cards (from Razorpay docs)
- Success: `4111 1111 1111 1111` any future date, any CVV
- Failure: `4111 1111 1111 1112`
