# GatherSpace — Play Store Asset Kit

All brand assets in this folder are generated deterministically by
`generate_assets.py`. Regenerate any time with:

```bash
cd /app/frontend/assets/images && python3 generate_assets.py
```

## What ships with the app (referenced from `app.json`)

| File | Size | Purpose |
|---|---|---|
| `icon.png` | 1024×1024 | Main launcher icon (iOS + Android + Play Store listing) |
| `adaptive-icon.png` | 1024×1024 | Android adaptive icon foreground (bg colour `#04372D`) |
| `splash-image.png` | 1284×2778 | Splash screen (portrait, dark forest bg) |
| `favicon.png` | 256×256 | Web preview favicon |
| `notification-icon.png` | 256×256 | Silhouette-only status-bar notification icon (Android) |

## What to upload to Play Store (Play Console → App content → Store listing)

| File | Where in Play Console |
|---|---|
| `icon.png` | *App icon* — required 512×512 (resize on upload) |
| `feature-graphic.png` (1024×500) | *Feature graphic* — required |
| Phone screenshots (see below) | *Phone screenshots* — at least 2 required |

### Phone screenshots (Play Store)
Play Console needs 2–8 screenshots per device type at **1080×1920** or higher.
Grab these from your generated Android build:

1. Welcome screen (`/(auth)/welcome`)
2. Discover screen with events (`/(consumer)/discover`)
3. Event detail with seat map (`/event/{id}`)
4. My Ticket screen with QR (`/ticket/{id}`)
5. Organizer analytics (`/(organizer)/analytics`)

## Brand tokens (kept in sync with `src/ThemeContext.tsx`)

- **Primary green**: `#059669` (button, badge fill)
- **Deep forest**: `#04372D` (splash bg, adaptive icon bg)
- **Mint highlight**: `#10B981` (gradient top)
- **Ink**: `#FFFFFF`

If you want to change the palette or the "GS" wordmark, edit
`generate_assets.py` and re-run — every asset will regenerate consistently.
