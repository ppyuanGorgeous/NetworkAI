# NetworkAI REST API

The browser uses the Next.js same-origin prefix `/api/backend`. Paths below describe the underlying Go API. Errors use plain-text responses unless otherwise indicated.

## Accounts

`POST /signup` accepts JSON containing `username` and `password` (optional `age` and `gender`). Usernames contain 1–64 lowercase ASCII letters or digits. Passwords contain 1–72 bytes. Success is HTTP 200; invalid input or a duplicate username is HTTP 400. Passwords are stored using bcrypt.

`POST /signin` (also `/auth/login`) accepts the same credentials. Success returns a plain-text JWT with `Cache-Control: no-store`. Invalid credentials return HTTP 401. JWTs use HS256, the `networkai` issuer, and a 24-hour expiry.

Protected routes require `Authorization: Bearer <TOKEN>`. Missing, invalid, or expired tokens return HTTP 401.

## Search

`GET /posts/search?keywords=caption+terms` searches caption words with AND matching.

`GET /posts/search?user=username` filters by the exact author. If both parameters are present, the author filter takes precedence. With neither parameter, the current result page is returned. Results are JSON arrays; no matches produce `[]`.

## Publish

`POST /posts` accepts authenticated `multipart/form-data`:

| Field | Meaning |
| --- | --- |
| `message` | Required, nonblank caption |
| `media_file` | Required, nonempty image or video |

The author comes from the JWT, regardless of any submitted `user` field. The total request limit is 32 MiB. Supported media include JPEG, PNG, GIF, WebP, MP4, MOV, WebM, and the legacy AVI/FLV/WMV formats. The server validates the extension and supported content headers.

A successful HTTP 200 response contains `id`, `user`, `message`, `url`, and `type`. In local mode, `url` uses `/api/backend/media/<objectName>`. Invalid input returns HTTP 400, oversized requests HTTP 413, and unsupported content HTTP 415.

## Media

`GET /media/{objectName}` and `HEAD /media/{objectName}` serve local files. The browser reaches these routes through `/api/backend/media/`. Byte ranges are supported for video playback. There is no directory-listing endpoint; path traversal and symbolic-link access are rejected.

## Delete

`DELETE /posts/{id}` requires the author's JWT. Success is HTTP 200 with an empty body. A missing post or a different author returns HTTP 404.

With local media storage, successful deletion removes the search record and its media file. Failed indexing after a local upload also cleans up the new file. The optional Google Cloud Storage mode retains the original cloud object lifecycle.

## Health

`GET /healthz` returns HTTP 200 for process liveness. Compose waits for Elasticsearch health before starting the API, and verifies the API through the web proxy before declaring the stack ready.

## Local configuration

`MEDIA_STORAGE=local`, `MEDIA_LOCAL_DIR`, `MEDIA_PUBLIC_BASE_URL`, `ES_URL`, `ES_USERNAME`, `ES_PASSWORD`, and `JWT_SECRET` configure the local adapter. The JWT key must contain at least 32 bytes. `PORT` configures the container listener. Local mode supports environment-only startup.

Paid AI routes are owned by the Next.js server. Their runtime switch and private provider configuration are described in the root README.
