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

## Deploying to Vercel
Import the repository (or use **Publish** in v0). Set `SESSION_SECRET` and, if needed, `SECRETS_ENCRYPTION_KEY` and `CONTROL_PLANE_MONGODB_URI`. Security headers are in `next.config.mjs`. CSP is in report-only mode until you tighten it.
