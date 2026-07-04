# Mock Installation API

A tiny zero-dependency Node server that serves the **device** and **job** data
the Sunbelt Installer app fetches. The response shapes match what `App.js`
renders, so the app works against this API exactly as it does against the
inline `MOCK_DEVICES` / `MOCK_JOBS` fallbacks.

## Run

```bash
node server/index.js
# or
cd server && npm start
```

Starts on `http://localhost:4000` (override with `PORT`).

## Endpoints

| Method | Path            | Description                                  |
| ------ | --------------- | -------------------------------------------- |
| GET    | `/health`       | Health check → `{ "status": "ok" }`          |
| GET    | `/devices`      | All devices. Filter with `?status=Installed` |
| GET    | `/devices/:id`  | A single device by id                        |
| GET    | `/jobs`         | All jobs. Filter with `?status=` / `?assignedTo=` |
| GET    | `/jobs/:id`     | A single job by id                           |

`/health` is always public. CORS is open so the Expo web build can call it too.

## Okta verification

Set `OKTA_ISSUER` to enforce Okta access-token verification on every data
endpoint. The server then, on each request, requires an
`Authorization: Bearer <token>` header and:

1. fetches Okta's JWKS (cached for 1 hour),
2. verifies the token's **RS256 signature** against the matching key,
3. checks the `iss`, `aud`, `exp`/`nbf` claims (60s clock skew allowed).

The server auto-detects which Okta authorization server the issuer refers to
and resolves the JWKS/audience accordingly:

| Server type | `OKTA_ISSUER`                              | JWKS endpoint                    | Default `aud`        |
| ----------- | ----------------------------------------- | -------------------------------- | -------------------- |
| **Org**     | `https://trial-1152722.okta.com`          | `…/oauth2/v1/keys`               | the org URL          |
| Custom      | `https://…okta.com/oauth2/default`        | `…/oauth2/default/v1/keys`       | `api://default`      |

This app uses the **Org Authorization Server**:

```bash
OKTA_ISSUER=https://trial-1152722.okta.com \
node server/index.js
# OKTA_AUDIENCE defaults to the org URL for an org issuer; override if needed.
```

| Var             | Default                    | Notes                                       |
| --------------- | -------------------------- | ------------------------------------------- |
| `OKTA_ISSUER`   | _(unset)_                  | Set to enable verification.                 |
| `OKTA_AUDIENCE` | org URL / `api://default`  | Must match the access token's `aud`.        |

> The Org Authorization Server only issues Okta-reserved scopes (`openid`,
> `profile`, `email`, `groups`, …) — no custom scopes. Confirm the token's
> real `aud` (decode it at jwt.io) and set `OKTA_AUDIENCE` to match if the
> default is rejected.

Invalid/missing tokens get `401`. When `OKTA_ISSUER` is unset the server
runs in open **mock mode** — the `Authorization` header is accepted but not
checked. Zero external dependencies: verification uses Node's built-in
`crypto` and `https`.

The data lives in [`data/devices.json`](data/devices.json) and
[`data/jobs.json`](data/jobs.json) and is re-read on every request, so edits
show up without restarting.

## Point the app at it

In the project root `.env`, set the two URLs the app reads:

```env
EXPO_PUBLIC_DEVICE_API_URL=http://localhost:4000/devices
EXPO_PUBLIC_JOBS_API_URL=http://localhost:4000/jobs
```

> On a physical Android device, `localhost` refers to the phone, not your
> machine — use your computer's LAN IP (e.g. `http://192.168.1.20:4000/devices`)
> or `adb reverse tcp:4000 tcp:4000`.
