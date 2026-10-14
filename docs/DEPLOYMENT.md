# GatherSpace — production deployment runbook (AWS)

Target: `https://api.gatherspace.in` on one AWS Lightsail server in Mumbai,
MongoDB Atlas M0, S3 for images + backups, deploys from GitHub Actions.
Cost ≈ $8/month. Files live in `deploy/` and `.github/workflows/backend.yml`.

```
 phone app ──HTTPS──▶ Caddy (443, auto TLS) ──▶ backend container (FastAPI, 2 workers)
                         Lightsail 1 GB, Mumbai          │            │
                                                         ▼            ▼
                                                 MongoDB Atlas M0   S3 bucket
                                                 (AWS Mumbai)       event-images/  backups/mongo/
 GitHub push to main ─▶ Actions: tests → build image → GHCR → SSH deploy → health check
 Razorpay ─▶ POST /api/payments/webhook (payment.captured)
```

Secrets never go into git or the Docker image. On the server they live in
`/opt/gatherspace/backend.env` and `/opt/gatherspace/firebase-admin.json`.

## Current production setup (built 2026-10-11)
| Piece | Value |
|---|---|
| AWS account | A **standard** account (root MFA on). Not the "new AWS experience": those projects are locked to their creation region by an AWS-managed SCP (ours was Sydney), so Mumbai was impossible. |
| Local AWS CLI profile | `gs-prod` (`aws login --profile gs-prod --region ap-south-1`; session lasts 12 h, renews up to 90 days) |
| Budget | `gatherspace-monthly`, $15, emails to the owner at 80 % / 100 % actual and 100 % forecast |
| S3 | `gatherspace-prod-media` (ap-south-1), IAM user `gatherspace-server` (inline policy `gatherspace-s3`, one access key in `backend.env`) |
| Server | Lightsail `gatherspace-api`, `micro_3_1` ($7), ap-south-1a, Ubuntu 24.04, static IP `gatherspace-api-ip` = **65.2.231.136**, ports 22/80/443 |
| SSH | Admin key `~/.ssh/gs_admin` on the owner's PC (Lightsail key pair `gs-admin`): `ssh -i ~/.ssh/gs_admin ubuntu@65.2.231.136`. GitHub deploy key: only in the `LIGHTSAIL_SSH_KEY` secret. |
| Atlas | Project GatherSpace, cluster `cluster0` (M0, AWS Mumbai), Atlas default user, DB name `gatherspace`; IP access: 65.2.231.136 (+ the owner's PC, temporary) |
| DNS | GoDaddy: `A api → 65.2.231.136`, `A app → 65.2.231.136` (web app) |
| Razorpay | **Test keys** in production until live activation — KYC was rejected (Individual business type not supported for event ticketing; next: reapply as sole proprietorship / company). Webhook not configured yet (`/payments/webhook` returns 503 until `RAZORPAY_WEBHOOK_SECRET` is set). |
| GitHub | Environment `production` (no approval), secrets `LIGHTSAIL_HOST/USER/SSH_KEY`, variables `API_DOMAIN`, `DEPLOY_ENABLED=true`, `FIREBASE_WEB_API_KEY`, `FIREBASE_WEB_APP_ID` |
| Web app | `https://app.gatherspace.in` — Expo web build served by the same Caddy from `/opt/gatherspace/web/current` (→ `web/releases/<sha>`), deployed by `.github/workflows/web.yml` on frontend changes. Installable ("Add to Home Screen"). Phone OTP on web uses the Firebase JS SDK + invisible reCAPTCHA (Firebase **Web app** config; domain in Firebase Auth → Authorized domains; API key restricted to HTTP referrers `app.gatherspace.in`, `localhost`). |

**Change a secret on the server** (value never shown): `/opt/gatherspace/set-secret.sh KEY`, then `docker compose -f docker-compose.prod.yml up -d backend`.

**Payments switch:** production runs `PAYMENTS_ENABLED=0` ("coming soon": online checkout off, pay at venue only, organizer publish fee waived past the free tier, only the 24 h boost — free). The app reads it from `/payments/config` + `/pricing/config`, so no app release is needed to change it.

**When Razorpay goes live:** `set-secret.sh RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, then `PAYMENTS_ENABLED` = `1` → restart backend → add the live webhook (step 6) → test one real ₹1–₹10 payment + refund.

---

## 1. AWS account + billing safety (owner, ~10 min)
1. Create/sign in to the AWS account → enable **MFA** on the root user.
2. Billing → **Budgets** → Create budget → Monthly cost budget **$15** → email alert at 80 % and 100 %.
3. Top-right region selector → **Asia Pacific (Mumbai) ap-south-1** for everything below.

## 2. S3 bucket + access key (owner, ~15 min)
1. S3 → Create bucket `gatherspace-prod-media` (region ap-south-1).
   - Object Ownership: **ACLs disabled**.
   - Block Public Access: keep the two **ACL** boxes ticked; **untick** the two **bucket policy** boxes (needed so event images can be public). Confirm.
2. Bucket → Permissions → **Bucket policy** (event images are public, backups stay private):
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Sid": "PublicEventImages",
       "Effect": "Allow",
       "Principal": "*",
       "Action": "s3:GetObject",
       "Resource": "arn:aws:s3:::gatherspace-prod-media/event-images/*"
     }]
   }
   ```
3. Bucket → Management → **Lifecycle rule** "expire-backups": prefix `backups/`, expire current versions after **30 days**.
4. IAM → Users → Create user `gatherspace-server` (no console access) → Attach policy → Create inline policy (JSON):
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject"],
         "Resource": ["arn:aws:s3:::gatherspace-prod-media/event-images/*",
                      "arn:aws:s3:::gatherspace-prod-media/backups/*"] },
       { "Effect": "Allow", "Action": "s3:ListBucket",
         "Resource": "arn:aws:s3:::gatherspace-prod-media" }
     ]
   }
   ```
   User → Security credentials → **Create access key** ("Application running outside AWS") → save the key id + secret for `backend.env`.

## 3. MongoDB Atlas M0 (owner, ~10 min)
1. cloud.mongodb.com → new Project "GatherSpace" → **Create** cluster → **M0 Free**, provider **AWS**, region **Mumbai (ap-south-1)**, name `gatherspace`.
2. Database Access → Add user `gatherspace_app`, password (generate), role **readWrite** on database `gatherspace`.
3. Network Access → Add IP → the Lightsail **static IP** (step 4). Temporarily your PC's IP too if you want to inspect data with Compass.
4. Connect → Drivers → copy the `mongodb+srv://…` URI → put the password in → `MONGO_URL` in `backend.env`.

## 4. Lightsail server (owner, ~15 min)
1. Lightsail → Create instance → Mumbai (ap-south-1a) → Linux/Unix → **OS only: Ubuntu 24.04 LTS** → plan **$7 (1 GB RAM, 2 vCPU, 40 GB SSD)** → name `gatherspace-api`.
2. Networking → **Create static IP** → attach to `gatherspace-api` (free while attached). Note the IP.
3. Instance → Networking → IPv4 firewall: keep SSH 22 and HTTP 80, **add HTTPS 443 (TCP)**. (Optional: restrict SSH to your IP.)
4. Connect with the browser SSH button (or download the default key) and run:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/maq20261-sudo/eventra-em/main/deploy/setup-server.sh -o setup-server.sh
   sudo bash setup-server.sh
   ```
   (If the repo is private, paste the file contents instead — `nano setup-server.sh`.) Log out and back in afterwards.

## 5. DNS at GoDaddy (owner, ~5 min, propagation up to an hour)
GoDaddy → My Products → `gatherspace.in` → **DNS** → Add record:
| Type | Name | Value | TTL |
|---|---|---|---|
| A | `api` | Lightsail static IP | 600 |

Check: `nslookup api.gatherspace.in` returns the static IP. Caddy obtains the HTTPS certificate automatically on first start once this resolves.

## 6. Razorpay live mode (owner)
1. Complete **KYC / activation** in the Razorpay dashboard (needed for live keys).
2. Live mode → Settings → API Keys → **Generate live key** → `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`.
3. Settings → **Webhooks** → Add: URL `https://api.gatherspace.in/api/payments/webhook`, secret = a long random string (also put it in `RAZORPAY_WEBHOOK_SECRET`), events: **payment.captured**.
4. Settings → Payment capture → **Automatic** (the server also requests auto-capture per order).

## 7. Server secrets (owner + Claude, ~10 min)
What was actually done: Claude generated `backend.env` on the PC (new JWT secret,
Razorpay test + Google keys from the local `.env`, a freshly created S3 access
key) and streamed it over SSH without printing; copied `firebase-admin.json`;
the owner set `MONGO_URL` with `/opt/gatherspace/set-secret.sh MONGO_URL`.

Manual alternative, on the server as `ubuntu`:
```bash
cd /opt/gatherspace
nano backend.env              # fill from deploy/backend.env.example
nano firebase-admin.json      # paste the Firebase Admin key (same project as dev)
chmod 600 backend.env && chmod 644 firebase-admin.json
```
`JWT_SECRET_KEY`: new random value — `python3 -c "import secrets; print(secrets.token_urlsafe(48))"`.

## 8. GitHub Actions (owner, ~10 min)
1. On your PC: `ssh-keygen -t ed25519 -f gs_deploy -C github-deploy -N ""` → two files.
2. Server: append `gs_deploy.pub` to `/home/ubuntu/.ssh/authorized_keys`.
3. GitHub repo → Settings → **Environments** → New `production` (optionally require your approval).
4. Settings → Secrets and variables → Actions:
   - Secrets: `LIGHTSAIL_HOST` = static IP, `LIGHTSAIL_USER` = `ubuntu`, `LIGHTSAIL_SSH_KEY` = contents of `gs_deploy` (private key).
   - Variables: `API_DOMAIN` = `api.gatherspace.in`, `DEPLOY_ENABLED` = `true`.
5. Delete the local `gs_deploy` private key file once stored in GitHub.

## 9. First deploy + checks (together)
1. Merge to `main` (or Actions → backend → **Run workflow**). Watch: test → build → deploy → smoke test.
2. Verify:
   - `https://api.gatherspace.in/api/health` → `{"status":"ok","db":"ok","env":"production"}`
   - `https://api.gatherspace.in/api/auth/register` → 404 (legacy signup off)
   - preview APK (`npx eas-cli build --profile preview --platform android`): sign up with phone OTP, create an event with an uploaded cover (stored in S3), book with a real ₹1–₹10 payment, refund it, boost an event, scan the ticket.
   - Razorpay dashboard → Webhooks → delivery shows **200**.
3. Run one backup by hand: `/opt/gatherspace/backup.sh` → object appears under `backups/mongo/`.

## 10. App release + switch-over
1. Play Console: upload-key reset approved (EAS upload certificate); add **App signing** SHA-1/SHA-256 to Firebase (Android app).
2. Version codes above the store's (`npx eas-cli build:version:set`).
3. `npx eas-cli build --profile production --platform all` → `npx eas-cli submit` (Play internal testing first).
4. When both stores are live with the new version → shut down the Emergent backend.

---

## Operations

**Manual deploy / restart** (server):
```bash
cd /opt/gatherspace
docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f backend     # logs
```

**Web app rollback**: `cd /opt/gatherspace/web && ls -dt releases/*` → `ln -sfn releases/<older sha> current.tmp && mv -T current.tmp current` (the last 3 builds are kept; no restart needed).

**Web app locally**: `cd frontend; npx expo start --web` (or `npx expo export -p web` for the production build). Browser-only code lives in `*.web.ts` files (`src/firebase.web.ts`); `src/webAlert.ts` maps `Alert.alert` to browser dialogs.

**Rollback**: set `IMAGE_TAG=<previous commit sha>` in `/opt/gatherspace/.env`, then `docker compose -f docker-compose.prod.yml up -d`. (Every main commit has an image tagged with its sha in GHCR.)

**Restore a backup** (overwrites data — be sure):
```bash
aws s3 cp s3://gatherspace-prod-media/backups/mongo/<file>.archive.gz /tmp/   # or via the aws-cli container
docker run --rm -v /tmp:/b mongo:7.0 mongorestore --uri="$MONGO_URL" --archive=/b/<file>.archive.gz --gzip --drop
```

**Move old embedded images to S3** (once, after S3 is configured):
`docker compose -f docker-compose.prod.yml exec backend python migrations/004_images_to_s3.py`

**Payments that need attention**: `payment_intents` with `status: "refund_failed"` (refund couldn't be issued automatically — refund in the Razorpay dashboard) or stuck in `"processing"` for more than a few minutes.

**Monitoring (free)**: UptimeRobot HTTP monitor on `https://api.gatherspace.in/api/health` (5-min interval, email alert). Lightsail → instance → Metrics → alarm on CPU > 80 %.

**Upgrade path**: Lightsail 2 GB ($12) when memory is tight; Atlas Flex when the 512 MB M0 limit nears; a load balancer only when more than one server is needed.
