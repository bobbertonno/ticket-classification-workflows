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

## How MongoDB Atlas powers each feature

MongoDB Atlas is the only stateful component of the platform. The Next.js app on Vercel has no background workers, no queue, no cache, and no separate vector database. Every feature reads and writes the same Atlas cluster. The **Architecture** tab in the console shows this as an interactive diagram. This section describes the same thing feature by feature.

> In the fully simulated environment, `MemoryStore` implements the same `DataStore` interface in memory. The behavior below applies when an Atlas environment is connected (`MongoStore`).

### 1. Document model: one document for one domain entity
- **What it does:** tickets, workflow instances, workflow definitions, and classification results are stored as rich JSON/BSON documents.
- **How the app uses it:**
  - A workflow instance embeds its steps, with input, output, attempts, and errors for each one. One read returns the full state shown in **Live Executions**.
  - A Remedy ticket carries its timeline and originating agency, so there are no application-side joins.
  - Workflow definitions (steps, SLA, retry policy, approval policy) are versioned documents, validated with Zod before they're written.
- **Collections:** `remedy_tickets`, `workflow_instances`, `workflow_definitions`, `classification_results`
- **Why it's central:** the flexible schema follows the domain. Adding a step type or an extracted parameter needs no migration, and every page reads the same document.
- **Source:** `lib/domain/schemas.ts`

### 2. Unique and compound indexes: idempotency handled by the database
- **What it does:** unique indexes on `eventId`, `instanceId`, and `ticketId` guarantee that each event is processed only once.
- **How the app uses it:**
  - If you publish the same Kafka event twice, the second insert into `kafka_messages` fails with error `E11000`. The app treats it as a duplicate, and no second workflow is started.
  - Event replay in the **Kafka Simulator** relies on the same guarantee.
  - The compound index `{ status, nextRunAt }` lets each engine tick find the instances due to advance. `{ topic, timestamp }` powers the topic browser.
- **Collections:** `kafka_messages`, `workflow_instances`, `workflow_events`, `audit_logs`
- **Why it's central:** idempotency comes from the database, not from application locks, so it holds even with many concurrent serverless instances.
- **Source:** `lib/store/mongo-store.ts`

### 3. Document-level atomicity: safe workflow state transitions
- **What it does:** each workflow step advances through a conditional update that only matches if the instance is still in the expected state.
- **How the app uses it:**
  - The engine claims the current step with `updateOne({ instanceId, status: { $in: [...] } }, ...)`. If `matchedCount` is 0, another tick already advanced it, so a step never runs twice.
  - Approve, reject, retry, and cancel each change the instance in a single atomic update, so every view stays consistent.
  - Retries don't duplicate documents or final notifications, because side effects are keyed by deterministic IDs.
- **Collections:** `workflow_instances`, `human_tasks`, `remedy_tickets`
- **Why it's central:** this is what makes a persisted workflow engine possible with no background processes, which suits Vercel functions.
- **Source:** `lib/engine/engine.ts`

### 4. Event log and outbox: the database is the source of truth for the lifecycle
- **What it does:** simulated Kafka messages, workflow events, and outgoing notifications are persisted as append-only records.
- **How the app uses it:**
  - Each published event is written to `kafka_messages` with its `correlationId`, offset, and consumer status before the workflow starts.
  - `workflow_events` records every transition, and the execution detail page rebuilds its timeline from it.
  - Notifications follow an outbox pattern: they're written first, then marked as delivered. A tick recovers any message still `PENDING`.
- **Collections:** `kafka_messages`, `workflow_events`, `notifications`
- **Why it's central:** if the simulator is replaced by a real Kafka broker, the same persistence model still works.
- **Source:** `lib/engine/engine.ts`

### 5. Atlas Vector Search: semantic ticket classification
- **What it does:** the **Semantic Classification** feature finds the most similar examples in the knowledge base with `$vectorSearch`.
- **How the app uses it:**
  - The ticket request is turned into a vector and compared with more than 100 examples in `workflow_classification_knowledge`, using the `kb_vector_index` index.
  - A pre-filter on `active` and `embeddingModel` makes sure only vectors from the same model are compared.
  - The `vectorSearchScore` is shown as a raw cosine score, not as a calibrated probability.
- **Collections:** `workflow_classification_knowledge`, `classification_results`
- **Why it's central:** operational data and vectors live in the same cluster, so there's no separate vector database to keep in sync.
- **Source:** `lib/server/atlas.ts`

### 6. Voyage AI embeddings, external or generated by Atlas
- **What it does:** embeddings come from Voyage AI, in one of two modes chosen in the Setup Wizard.
- **How the app uses it:**
  - **Mode B (external API):** the server calls Voyage AI with `input_type: "document"` for the knowledge base and `"query"` for the ticket. Reranking is optional.
  - **Mode A (Atlas Automated Embedding, Preview):** the `kb_autoembed_index` index makes Atlas generate vectors both at indexing time and at query time. The app only sends text.
  - If no provider is available, the app uses a deterministic classifier that is clearly labeled as simulated and never claims to have called Voyage AI.
- **Collections:** `workflow_classification_knowledge`
- **Why it's central:** with Atlas-managed embeddings, the app needs no code to keep vectors in line with the data.
- **Source:** `lib/server/atlas.ts`

### 7. Search Index API: search infrastructure managed as code
- **What it does:** the Setup Wizard creates and checks the vector index from code, and waits until it can be queried.
- **How the app uses it:**
  - `createSearchIndex` with `type: "vectorSearch"` defines the dimensions, cosine similarity, and filter fields.
  - `listSearchIndexes` checks the status, and the UI shows `PENDING` until Atlas has built the index.
  - If the cluster doesn't support the feature, the status is `UNSUPPORTED` and classification stays on the labeled fallback.
- **Collections:** `workflow_classification_knowledge`
- **Why it's central:** the search index is created in the same setup step as the collections and the seed data.
- **Source:** `lib/server/atlas.ts`

### 8. Audit trail: the full history in the same database
- **What it does:** every meaningful action writes an audit event with the actor, the previous and new state, the outcome, and the `correlationId`.
- **How the app uses it:**
  - Approvals, rejections, retries, resets, and ticket transitions are recorded in `audit_logs`.
  - Indexes on `timestamp`, `ticketId`, and `agencyId` back the filters on the **Audit & Analytics** page.
  - Sensitive values (passwords, API keys, connection strings) are redacted before they're written.
- **Collections:** `audit_logs`, `artifacts`
- **Why it's central:** the database that runs the workflows also keeps their complete history, which you can query by ticket, agency, or actor.
- **Source:** `lib/engine/support.ts`

### 9. Security and separation between the control plane and the data plane
- **What it does:** the app only works on the demo database you selected. Credentials are encrypted and never sent back to the browser.
- **How the app uses it:**
  - Environment configuration (the control plane) is kept separate from the demo database you choose (the data plane).
  - The connection string is validated to prevent SSRF: only Atlas `*.mongodb.net` hosts are allowed, and the data database must differ from the control plane. It's encrypted with AES-256-GCM on the server.
  - The demo reset only touches the collections of the selected environment.
  - The recommended Atlas user has `readWrite` on the demo database only.
- **Collections:** `app_settings`
- **Why it's central:** Atlas's security model (per-database roles, network access, TLS) limits what the app can reach.
- **Source:** `lib/server/control-plane.ts`

### 10. Node.js driver in a serverless environment
- **What it does:** the MongoDB client is reused across function invocations with a small connection pool, which suits Vercel functions.
- **How the app uses it:**
  - A low `maxPoolSize` and a dedicated `appName` (`generali-automation-control-center`) keep connections bounded and easy to spot in Atlas monitoring.
  - The connection test runs `ping` and checks permissions before the environment is saved.
  - Cluster errors (unreachable, bad credentials) are shown as clear messages with no sensitive data.
- **Why it's central:** the whole platform runs without dedicated servers, with Atlas as its only stateful component.
- **Source:** `lib/server/atlas.ts`

### Feature-to-Atlas map

| Console feature | Atlas capabilities used |
|---|---|
| Kafka Simulator / event replay | Unique indexes (idempotency), event log |
| Live Executions and execution detail | Document model, atomic updates, `workflow_events` |
| Semantic Classification | Vector Search, Voyage AI / Automated Embedding, Search Index API |
| Human Tasks (approve / reject) | Atomic updates, audit trail |
| Notifications | Outbox pattern on `notifications` |
| Remedy tickets | Document model, atomic status transitions |
| Documents (XLSX / PDF) | `artifacts` collection with deterministic IDs |
| Audit & Analytics, Agency Performance | Indexed `audit_logs`, instance and ticket data |
| Setup Wizard / Settings | Driver `ping`, Search Index API, control-plane separation |

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
3. Choose a Voyage AI mode. Initialization creates the collections, indexes, and seed data, and, where supported, the `kb_vector_index` vector index (or `kb_autoembed_index` in Automated Embedding mode) on `workflow_classification_knowledge.embedding`. If embeddings are missing, or the vector index isn't ready yet, the app says so and uses the explicitly labeled fallback.

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
