# Changelog

## 0.2.0 — 2026-11-19

### Added

- `TelloApi`: a client for the public REST API (`https://api.telloai.io/v1`, override with `apiUrl` or `TELLO_API_URL`).
  - `tools`: `list` / `get` / `create` / `update` / `delete`.
  - `agents`, `crews`: `list` / `get` / `create` / `update` / `delete`. Writes save, deploy and promote at once.
  - `crews.generate` / `crews.generateAndWait` and `crewGenerations.get`: build a crew from a goal and follow the job.
  - `callDrafts.create` / `revise` / `confirm`: review an outbound call's scenario before dialing. `confirm` places a real, billed call.
  - Errors: `TelloApiError` (`status`, `code`, `data`, `idempotencyKey`), `TelloApiConnectionError`, `CrewGenerationTimeoutError`.
  - Writes use `longTimeoutMs` (120 s); requests are never retried.
- `PermissionDeniedError` for the WS `insufficientScope` error (`requiredScope`). Only that command is refused; the connection stays open.
- `AuthenticationError.ip` for the WS `ipNotAllowed` error (the key's allowed IP list does not include the connection's address).

### Changed

- `internalError` answering `auth` now rejects `connect()` with `TelloServerError`.
- Protocol, event and error contract copies synced from the API gateway (`api-gateway`).
