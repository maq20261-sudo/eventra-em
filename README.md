# GatherSpace

Event discovery and booking app. Attendees find and book nearby events; organizers create events, check in attendees by QR and see analytics.

| Part | Stack | Folder |
|---|---|---|
| Mobile app | Expo SDK 54 (React Native 0.81), expo-router, React Native Firebase (phone OTP) | `frontend/` |
| API | FastAPI + MongoDB (Motor), Razorpay, Firebase Admin, Google Places proxy | `backend/` |

## Local development (Windows + Rancher Desktop)

### One-time setup

1. Install **Rancher Desktop**, **Node.js LTS** and **VS Code**:
   `winget install SUSE.RancherDesktop OpenJS.NodeJS.LTS Microsoft.VisualStudioCode`.
   Rancher Desktop needs WSL2 (`wsl --install --no-distribution`, then reboot).
2. Rancher Desktop → Preferences:
   - **Container Engine:** `dockerd (moby)`
   - **Kubernetes:** off
   - **WSL → Resources:** about 3 GB memory, 2 CPUs
3. Create the env files from the templates:
   - `backend/.env.example` → `backend/.env` (set `JWT_SECRET_KEY`; Razorpay and Maps keys are optional locally)
   - `frontend/.env.example` → `frontend/.env` (set your PC's LAN IP)
4. Optional, for real phone OTP: put the Firebase Admin key at `backend/credentials/firebase-admin.json`.
5. Open the folder in VS Code and accept the recommended extensions.

### Daily workflow

```bash
docker compose up -d                        # MongoDB + API (hot reload) on :8001
docker compose exec backend python seed.py  # demo data (wipes bookings; local only!)
docker compose logs -f backend

cd frontend
npm install
npx expo start --dev-client                 # then open the GatherSpace dev build on your phone
```

The API is at `http://localhost:8001/api/` and the interactive docs at `http://localhost:8001/docs`.

Demo logins after seeding (local only):
- Organizer: `demo@organizer.com` / `password123`
- Attendee: `demo@consumer.com` / `password123`

### Tests

```bash
docker compose --profile test run --rm tests
```

This runs the pytest suite against an isolated `backend-test` server. That server uses its own `gatherspace_test` database and mocked Firebase/SMS, so your dev data is untouched.

### Working in VS Code

Open the repo folder (`code .`). One-time: create the backend venv for IntelliSense and local pytest (Python 3.11):

```powershell
py -3.11 -m venv backend\.venv
backend\.venv\Scripts\python -m pip install -r backend\requirements-dev.txt
```

**Run** — `Ctrl+Shift+P` → *Tasks: Run Task*:

| Task | What it does |
|---|---|
| `Start stack` | `docker compose up -d`, then backend logs + Metro side by side |
| `Backend: logs` / `Backend: stop` / `Backend: seed demo data` | |
| `Backend: tests (Docker)` | Full suite in Docker (same as above) |
| `Frontend: Metro` / `Frontend: Metro (web)` | `expo start --dev-client` / `--web` |
| `Frontend: typecheck` / `Frontend: lint` | Results land in the Problems panel |

**Debug** — Run and Debug panel (`Ctrl+Shift+D`):

- `Backend: Attach (Docker)` — the backend container always runs under debugpy on `127.0.0.1:5678`. Set breakpoints in `backend/*.py` and press F5; they keep working across hot reloads.
- `Frontend: Attach (Expo)` — with Metro running and the dev build open on the phone. Alternatively press `j` in the Metro terminal for React Native DevTools.
- `Full stack: Attach both`.

**Logs** — backend: `Backend: logs` task (or the Containers view). App `console.log`: the Metro terminal.

**Tests panel** — run the `Backend: start test server (for Testing panel)` task once; the Testing panel then runs pytest from `backend/.venv` against the isolated test server on `127.0.0.1:8002` (see `.vscode/pytest.env`), never your dev data.

### Database browser

You have two options:
- **MongoDB for VS Code** connected to `mongodb://localhost:27017`
- `docker compose --profile tools up -d mongo-express`, then open http://localhost:8082

### Running on a phone

The app uses native Firebase, so **Expo Go can't run it**. You need a development build:

```bash
cd frontend
npx eas-cli login
npx eas-cli build --profile development --platform android   # or ios
```

Install the build on your phone, run `npx expo start --dev-client`, and scan the QR code. The phone must be on the same Wi-Fi network as the PC, and Windows Firewall must allow inbound TCP 8001 (API) and 8081 (Metro).

## Builds and releases

`frontend/eas.json` has three profiles:

| Profile | Purpose | Backend |
|---|---|---|
| `development` | Dev client, uses your local `.env` | Your PC |
| `preview` | Internal APK/IPA for testers | `https://api.gatherspace.in` |
| `production` | Store builds (version auto-increment) | `https://api.gatherspace.in` |
