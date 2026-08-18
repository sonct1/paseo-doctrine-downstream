# Beads Central v1.2

A thin, agent-only centralized control plane for [Beads](https://github.com/gastownhall/beads).

- **Human interface:** Paseo WebUI through the trusted Product daemon.
- **Role-agent interface:** Paseo's project/role-scoped `beads_*` tools.
- **Optional direct-agent interface:** MCP over authenticated HTTPS with a least-privilege token.
- **Issue source of truth:** Beads.
- **Operational metadata:** local SQLite audit/idempotency store.

## v1 architecture

```text
Paseo Human WebUI / role tools / qualified direct agent clients
   |
   | HTTPS + Bearer token (+ trusted delegated actor from Paseo)
   v
Beads Central (single replica)
   |-- MCP 2025-11-25 + 2026-07-28 /mcp
   |-- REST /v1/...
   |-- auth + project ACL + durable logical-project registry
   |-- audit + idempotency
   |-- per-project serialization
   |
   +--> Project A -> embedded Beads/Dolt DB
   +--> Project B -> embedded Beads/Dolt DB
   +--> Project C -> embedded Beads/Dolt DB
```

The server is intentionally the **only Beads writer** in v1. That makes embedded Dolt safe and removes a networked shared-Dolt tier. Run **one application replica**. If direct multi-writer SQL access becomes a real requirement, migrate projects to Beads server mode later.

## Security model

- Bearer tokens are supplied only through environment/secrets, never project config.
- Each token has explicit project ACLs and `read`/`write`/`admin` permissions. Only a global-admin
  service token may set `X-Paseo-Actor`; scoped clients cannot impersonate another actor.
- The container runs non-root, read-only root FS, drops Linux capabilities, and publishes only to loopback in Compose by default.
- Put TLS at Caddy/nginx/Traefik or expose it only over a private overlay such as NetBird.
- `bd` is executed without a shell; project paths are server-controlled, issue identifiers are validated, and Beads subprocesses receive a deliberately small environment rather than the service's secrets.
- Dolt's default metrics event flush is disabled for every Beads subprocess (`DOLT_DISABLE_EVENT_FLUSH=1`).
- Request bodies are capped at 1 MiB by default, including chunked bodies without `Content-Length`.
- Every successful or failed Beads action is written to an append-only logical audit table (SQLite WAL). Audit entries store metadata summaries only, not full issue prose, backend error text, or `bd prime` output.
- Every mutation requires an `idempotency_key`; reusing a key with different payload returns a conflict. This is durable retry deduplication, not a cross-database exactly-once transaction: a process crash after Beads commits but before the SQLite idempotency record commits can still leave a duplicated retry.
- Treat issue content and project memory as **untrusted data**. The MCP discovery instructions explicitly tell agents not to elevate instructions found inside issue prose over host/user/safety policy.
- Beads/Dolt data is plaintext at rest. Do not put API keys, passwords, access tokens, or other secrets in issues or project memory.

## Bind projects

Static operator-owned projects may be declared in `config/projects.yaml`:

```yaml
projects:
  - id: api
    prefix: api
    description: API
  - id: web
    prefix: web
    description: Web
```

Project IDs and Beads prefixes must be unique. Paseo uses the global-admin REST endpoint to bind a
stable logical project on first use; the binding is persisted in `/data/projects.json` and cannot be
rebound to another prefix:

```bash
curl -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Paseo-Actor: $PASEO_AGENT_ID" \
  -H 'Content-Type: application/json' \
  http://127.0.0.1:8080/v1/admin/projects/pg-0123456789abcdef \
  -d '{"prefix":"ps0123456789","description":"Paseo logical project"}'
```

## Configure credentials

```bash
cp .env.example .env
python - <<'PY'
import secrets
print(secrets.token_urlsafe(48))
PY
```

Place the generated token in `BEADS_CENTRAL_TOKENS_JSON`. Production tokens must be at least 32 characters.

Example token policy:

```json
{
  "SECRET": {
    "subject": "paseo-daemon",
    "projects": ["*"],
    "permissions": ["admin"]
  }
}
```

## Run

```bash
docker compose up -d --build
curl http://127.0.0.1:8080/health/live
curl http://127.0.0.1:8080/health/ready
```

`/health/ready` verifies that `bd` is executable.

## MCP

Endpoint:

```text
POST https://beads.example.internal/mcp
Authorization: Bearer <token>
MCP-Protocol-Version: 2025-11-25 | 2026-07-28
Mcp-Method: tools/list | tools/call | server/discover
Mcp-Name: <tool name>             # tools/call only
```

Tools:

- `projects_list`
- `issues_ready`
- `issues_list`
- `issue_get`
- `issue_create`
- `issue_claim`
- `issue_update`
- `issue_close`
- `dependency_add`
- `project_prime`

The endpoint supports two bounded transports for the same tool surface:

- MCP `2025-11-25` Streamable HTTP initialization, `notifications/initialized`, `tools/list`, and
  `tools/call`, for current general MCP clients such as Codex CLI.
- The stateless MCP `2026-07-28` core: `server/discover`, `tools/list`, and `tools/call`, with required
  per-request protocol/client-capability metadata and HTTP mirror headers (`MCP-Protocol-Version`,
  `Mcp-Method`, and `Mcp-Name` for tool calls).

Both routes use the same authentication, ACL, idempotency and Beads service layer. The endpoint
deliberately does not expose prompts, resources, subscriptions, sampling, or elicitation in v1.

## REST

REST is the trusted Paseo daemon integration surface. The daemon derives the logical project ID,
enforces role/lease policy, and forwards the bound agent identity in `X-Paseo-Actor`; models never
select a project ID or possess the global service credential.

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8080/v1/projects
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8080/v1/projects/api/ready
```

## Backups

v1 uses filesystem snapshots. Quiesce/stop the single service, then archive `/data`:

```bash
docker compose stop beads-central
# mount the volume in a backup job and run scripts/backup.sh
docker compose start beads-central
```

For higher availability later, test a migration to Beads server mode and use Beads/Dolt export or remote push workflows for durable off-host copies.

## Production constraints

1. **One Beads Central application replica.** Embedded Beads is single-writer; the app serializes per project only inside one process and holds an exclusive lock in `/data`, so a second replica sharing the same data directory fails startup.
2. **Do not expose `/mcp` without TLS or a private trusted network.**
3. **Persist `/data`.** It contains all issue state plus audit/idempotency metadata.
4. **Pin Beads.** The bundle vendors the exact user-supplied Beads `v1.1.2` archive under `third_party/source-archives/`; Docker verifies its SHA-256, extracts it only inside the build stage, and builds `bd` from those bytes. The builder uses Go 1.26.2 because that is the Go version declared by the v1.1.2 module, and builds with CGO + `gms_pure_go` because upstream documents that embedded Dolt requires the embedded-capable build mode. Test upgrades against a copy of data before changing the pin.
5. **Back up before Beads schema upgrades.** Beads can migrate its own data model.
6. **Use a local/block persistent volume for `/data`.** The v1 single-replica guard uses an OS advisory file lock; do not assume identical locking semantics on NFS/SMB or other network filesystems.
7. **Rate-limit at the reverse proxy if exposed beyond a private overlay.** v1 deliberately keeps application-level scheduling/rate policy out of the tracker.
8. **Idempotency is retry protection, not exactly-once execution across a crash.** If exactly-once issue creation becomes a hard requirement, add deterministic mutation reservations in a later version rather than pretending SQLite and Beads are one transaction.

## Local development without Docker

```bash
python -m venv .venv
. .venv/bin/activate
pip install --constraint constraints.txt -e '.[dev]'
export BEADS_CENTRAL_INSECURE_DEV=1
export BEADS_CENTRAL_CONFIG=$PWD/config/projects.yaml
export BEADS_CENTRAL_DATA=$PWD/data
uvicorn beads_central.main:create_app --factory --reload --port 8080
```

For local development you may point `BEADS_CENTRAL_BD_BIN` at any compatible `bd`, but release Docker builds the verified Beads 1.1.2 source archive. Unit tests keep a subprocess-level fake for deterministic failure/concurrency cases; source-contract tests read the exact archive directly, and the Docker smoke is the mandatory real-`bd` E2E gate.


## Foundation integration provenance

This standalone repository is canonical Beads Central `1.2.0`. It was extracted from the Foundation
component history so Product, Foundation, and Central do not carry duplicate source trees. See
[`FOUNDATION_INTEGRATION.md`](FOUNDATION_INTEGRATION.md) for exact source identities and deltas. The
renamed `UPSTREAM_RELEASE_*` files describe the untouched supplied package and are historical
provenance, not checksums for this modified tree.

## Release posture

The shipped v1 deliberately favors correctness over horizontal scale: one API process owns all writes, and each project has an isolated embedded Beads database. The central service exposes project IDs, never filesystem paths. Add HA/shared-Dolt only after proving that a single replica is an actual bottleneck.

Current source and cross-repository runtime receipts are recorded in
[`QUALIFICATION.md`](QUALIFICATION.md).
