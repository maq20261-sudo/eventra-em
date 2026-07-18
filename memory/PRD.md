# GatherSpace — Event Management App

## Overview
Mobile-first event management app with two user roles: **Consumers** who discover and book events, and **Organizers** who create and manage events with analytics.

## Tech Stack
- Frontend: Expo (React Native) SDK 54, expo-router, expo-location, expo-image
- Backend: FastAPI + Motor (async MongoDB)
- Auth: JWT (email/password) with bcrypt; token stored in SecureStore

## Features
### Auth
- Register/Login with role selection (Attendee / Organizer)
- JWT token stored securely; auto sign-in on app open
- Demo accounts seeded

### Consumer (Attendee)
- **Discover**: Geo-based feed with radius filter (5/10/25/50/100 km), category chips, search
- **Location**: GPS via expo-location OR default to San Francisco; radius persisted
- **Event Detail**: Hero image, description, organizer info, sticky Book CTA
- **Booking flows** (3 types):
  - Seat map: interactive grid, real-time availability
  - General admission: quantity stepper
  - Time slots: pick from organizer-defined slots
- **My Tickets**: Upcoming / Completed segmented view

### Organizer
- **Events list**: All owned events with sold/capacity progress bars
- **Create/Update Event**: Full form with category, image picker, date/time, GPS location, price, and booking type-specific settings
- **Analytics**: Revenue, tickets sold, events, unique attendees KPIs; category breakdown bars; top events by revenue

## API
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET/POST/PUT/DELETE /api/events`, `GET /api/events/{id}`, `GET /api/events/{id}/booked-seats`
- `GET /api/organizer/events`
- `POST /api/bookings`, `GET /api/bookings/me`, `POST /api/bookings/{id}/cancel`
- `GET /api/analytics/organizer`

## Design
Following `/app/design_guidelines.json` — iOS-Native Clean, emerald `#059669` brand, Ionicons, generous spacing, gradient scrims over event imagery.

## Demo Credentials
See `/app/memory/test_credentials.md`.
