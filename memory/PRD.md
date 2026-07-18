# GatherSpace — Event Management App

## Overview
Mobile-first event management app with two user roles: **Consumers** discover and book events, **Organizers** create, manage, and check in attendees. Payment collected at venue (no gateway yet); tickets verified via QR scanning.

## Tech Stack
- Frontend: Expo (React Native) SDK 54, expo-router, expo-location, expo-image, expo-camera, react-native-qrcode-svg
- Backend: FastAPI + Motor (async MongoDB)
- Auth: JWT (email/password) with bcrypt; token stored in SecureStore

## Features

### Auth
- Register/Login with role selection (Attendee / Organizer)
- JWT token stored securely; auto sign-in on app open
- Demo accounts seeded

### Consumer (Attendee)
- **Discover**: Geo-based feed with radius filter (5/10/25/50/100 km), category chips, search. Featured/boosted events surface at the top with an amber flame badge.
- **Location**: GPS via expo-location OR default; radius persisted
- **Event Detail**: Hero image, description, organizer info, sticky Book CTA
- **Booking flows** (3 types): Seat map (interactive), General (stepper), Time slots
- **QR Ticket**: Each confirmed booking generates a scannable QR code. "Pay $X at venue" notice on unpaid tickets.
- **My Tickets**: Upcoming / Completed segmented view
- **Profile**: Real content — notification toggles (persisted), privacy statement, FAQ, About

### Organizer
- **Events list**: All owned events with sold/capacity progress bars, per-event Boost + Edit buttons
- **Create/Update Event**: Full form with category, image picker, date/time, GPS location, price, booking-type-specific settings
- **Boost / Featured tier** (smart business enhancement): 3 tiers — 1 Day ($4.99), 7 Days ($14.99, popular), 30 Days ($39.99). Stackable duration. Featured events appear first in Discover with a Featured badge. Payment is simulated (no gateway integrated yet).
- **QR Scanner**: `expo-camera`-powered scanner tab. Reads consumer QR, calls `/api/checkin`, shows Welcome / Already Checked In / Not Valid result modal with attendee name, seats/slots, and "Collect $X at venue" reminder for paid tickets.
- **Analytics**: KPIs (Revenue, Tickets Sold, Checked In, Events, Attendees), category breakdown bars, top events by revenue

## API
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET/POST/PUT/DELETE /api/events`, `GET /api/events/{id}`, `GET /api/events/{id}/booked-seats`
- `GET /api/organizer/events`
- `GET /api/events/{id}/feature-tiers`, `POST /api/events/{id}/feature` (organizer, stackable)
- `POST /api/bookings`, `GET /api/bookings/me`, `POST /api/bookings/{id}/cancel`
- `POST /api/checkin` (organizer, idempotent)
- `GET /api/analytics/organizer` (includes `checked_in_tickets`)

## Testing
- **50/50 backend tests pass** (37 regression + 13 new for check-in + boost)
- Frontend flows validated via screenshots: consumer booking + QR ticket, organizer boost sheet

## Demo Credentials
See `/app/memory/test_credentials.md`.
