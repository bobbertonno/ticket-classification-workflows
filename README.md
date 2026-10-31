# Generali Automation Control Center (Demo)

A demo console for monitoring and orchestrating enterprise automation workflows, both fully automated and Human-in-the-Loop. It simulates the full flow: BMC Remedy ticket → Kafka event → semantic classification (Voyage AI + Atlas Vector Search) → workflow → approval → document → notification → ticket closure.

> Demo application inspired by Generali's visual identity. **Not an official Generali product.** All agency, claims, and policy data is synthetic.

## Architecture

| Layer | Path | Notes |
|---|---|---|
| Domain model + Zod | `lib/domain/` | Schemas for all 12 collections, seed data (8 agencies, 100+ classification examples, 4 scenarios) |
| Data store | `lib/store/` | `DataStore` interface with two implementations: `MemoryStore` (explicitly labeled simulation) and `MongoStore` (MongoDB Node.js Driver, indexes, atomic updates) |
| Classification | `lib/classification/` | Keyword, simulated deterministic, Voyage AI external (`voyage-4`), Atlas `$vectorSearch`, optional rerank, deterministic decision policy |
| Engine | `lib/engine/` | Persisted state machine advanced by explicit ticks (`/api/engine/tick`), idempotency by `eventId`, outbox recovery, retry/backoff, escalation |
| Documents | `lib/documents/` | Real XLSX (claims) and PDF (policies), marked DEMO / SYNTHETIC DATA |
| Server | `lib/server/` | Signed session, roles (admin / approver / viewer), AES-256-GCM-encrypted secrets, SSRF guard, structured OTel-style logs |
| UI | `app/(console)/`, `components/` | 10 sections, demo control bar, setup wizard |

### Execution in a serverless environment
There are no background processes or long-running timers. Workflow state lives in the store. The client sends a heartbeat (`POST /api/engine/tick`) that advances eligible instances by one step, and recovers `PENDING` messages through the outbox pattern. `lib/engine/engine.ts` (`tick`, `executeStep`) is the extension point for Temporal, Camunda, Inngest, or Vercel Workflow.

## Environments

1. **Fully simulated demo** (default, no credentials needed). Data lives in an in-memory store for each server instance. On Vercel, a cold start or a different instance can reset the data. The UI says this clearly, and never claims the data is in MongoDB.
2. **Development**: uses `MONGODB_URI` / `MONGODB_DB` from the server environment.
3. **Custom MongoDB Atlas**: configured from the Setup Wizard. The connection string is encrypted server-side, and the client only ever sees an opaque reference.

## Environment variables (server only, never `NEXT_PUBLIC_`)

| Variable | Required | Purpose |
|---|---|---|
| `SESSION_SECRET` | yes in production | Signs the session cookie (≥32 characters) |
| `SECRETS_ENCRYPTION_KEY` | to save Atlas/Voyage credentials | AES-256-GCM key (`openssl rand -base64 32`) |
| `CONTROL_PLANE_MONGODB_URI` / `CONTROL_PLANE_DB` | to persist environment configurations | Control-plane database, separate from the data plane |
| `MONGODB_URI` / `MONGODB_DB` | optional | Development environment |
| `VOYAGE_API_KEY` / `VOYAGE_MODEL` | optional | External Voyage AI (default `voyage-4`) |
| `ALLOW_NON_ATLAS_MONGODB` | optional | Allows non-`mongodb.net` hosts (development only) |

Credentials are never sent back to the browser, written to logs, or kept in localStorage. Connection destinations are validated (Atlas `mongodb+srv` hosts only, private and loopback IPs blocked).

## Atlas setup
1. Create a least-privilege user with `readWrite` on the demo database only.
2. In the app, go to **Settings & Integrations → Setup Wizard**, then Test Connection → Validate Permissions → Save Securely.
3. Choose a Voyage AI mode. Initialization creates the collections, indexes, and seed data, and, where supported, the `classification_vector_index` vector index on `workflow_classification_knowledge.embedding`. If embeddings are missing, or the vector index isn't ready yet, the app says so and uses the explicitly labeled fallback.

## Demo journey (3–5 minutes)
Overview → Kafka Simulator (Scenario A, MI001) → Publish → Live Executions → Semantic Classification → Human Tasks (Approve) → Notifications → Remedy ticket CLOSED → Audit → XLSX download → Agency Performance. The **Demo Control Bar** provides pause/resume, speed, failure injection, retry, and reset (with confirmation).

## Commands
```bash
pnpm install
pnpm dev          # development
pnpm test         # vitest: state transitions, classification routing, idempotency, scenario lifecycles A–D
pnpm typecheck
pnpm build
```

## Running on a local machine

### Prerequisites
- **Node.js 20.9 or later** (required by Next.js 16). Check with `node -v`.
- **pnpm**, the version pinned in `package.json` (`packageManager`). The easiest way to get it is Corepack, which ships with Node.js: `corepack enable`.
- **Git**.
- Optional: a **MongoDB Atlas** cluster and a **Voyage AI** API key, for real persistence and semantic classification. Without them, the app runs in the fully simulated mode.

### 1. Clone and install
```bash
git clone https://github.com/bobbertonno/ticket-classification-workflows.git
cd ticket-classification-workflows
corepack enable
pnpm install
```

### 2. Configure environment variables
Create a `.env.local` file in the project root. Next.js loads it automatically, and it is git-ignored, so never commit it.

```bash
# Required: signs the session cookie and encrypts saved environments (≥32 characters)
SESSION_SECRET=<output of: openssl rand -base64 32>

# Needed to save Atlas/Voyage credentials from the Setup Wizard
SECRETS_ENCRYPTION_KEY=<output of: openssl rand -base64 32>

# Optional: development data plane (skip to use the in-memory simulation)
# MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
# MONGODB_DB=automation_control_center

# Optional: external Voyage AI
# VOYAGE_API_KEY=<your Voyage AI key>
# VOYAGE_MODEL=voyage-4

# Optional, local development only: allow a non-Atlas MongoDB (for example a local mongod)
# ALLOW_NON_ATLAS_MONGODB=true
```

If you don't have `openssl`, any random string of at least 32 characters works, for example the output of `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

Changing `SESSION_SECRET` invalidates existing sessions and every environment saved in the browser.

### 3. Start the app
```bash
pnpm dev
```
Open [http://localhost:3000](http://localhost:3000). To use another port, run `pnpm dev -- -p 3001`.

To run a production build locally instead:
```bash
pnpm build
pnpm start
```

### 4. Connect Atlas (optional)
1. In Atlas, go to **Network Access** and add your machine's public IP (or a temporary `0.0.0.0/0` for a quick demo).
2. Create a database user with `readWrite` on the demo database only.
3. In the app, open **Settings & Integrations → Setup Wizard**, then follow the steps in [Atlas setup](#atlas-setup).

### 5. Verify
```bash
pnpm typecheck
pnpm test
```

### Troubleshooting
- **`ENV_NOT_FOUND` after saving an environment:** check that `SESSION_SECRET` is set, then restart `pnpm dev` after editing `.env.local`.
- **Connection rejected:** only `mongodb+srv` hosts on `mongodb.net` are accepted unless `ALLOW_NON_ATLAS_MONGODB=true` is set. Private and loopback IPs are blocked by the SSRF guard.
- **Atlas timeout:** your IP is missing from the Atlas access list, or a corporate proxy or VPN is blocking port 27017.
- **"Simulated deterministic classifier" banner:** you're looking at a pre-loaded historical ticket, or embeddings or the vector index aren't ready yet. Publish a new event from the Kafka Simulator.
- **Port 3000 already in use:** start on another port with `pnpm dev -- -p 3001`.

## Deploying to Vercel
Import the repository (or use **Publish** in v0). Set `SESSION_SECRET` and, if needed, `SECRETS_ENCRYPTION_KEY` and `CONTROL_PLANE_MONGODB_URI`. Security headers are in `next.config.mjs`. CSP is in report-only mode until you tighten it.
