# NetworkAI frontend

A responsive Next.js and React interface for the NetworkAI media-sharing project. The Go API, Elasticsearch, local media storage, and application are started together from the [repository root](../README.md).

## Implemented flows

- Registration and JWT sign-in; tab-scoped session storage and explicit sign-out.
- Authenticated discovery, caption keyword searches, author filters, and a personal posts view.
- Image/video previews and multipart publishing, with file type and size checks.
- Author-only delete controls with confirmation, plus server-enforced ownership.
- Loading, empty, retry, upload, deletion, and expired-session states.
- Optional AI image generation/reference-image editing and a networking assistant that searches actual community posts. Generated images are previewed and require an explicit publish action.

## Local development

Use Node.js 24. From this directory:

```bash
npm ci
INTERNAL_API_URL=http://127.0.0.1:8080 npm run dev
```

The same-origin `/api/backend/*` route forwards only supported operations to the Go service. Local media is served through `/api/backend/media/*`; byte-range requests support video playback. `INTERNAL_API_URL` is a server setting and is never embedded as a browser endpoint.

For the complete local environment, use the root Docker Compose workflow instead. Production output uses Next.js standalone mode.

## Optional paid AI

AI requests require server settings `ENABLE_PAID_AI=true`, `OPENAI_API_KEY`, and the relevant `OPENAI_IMAGE_MODEL` or `OPENAI_AGENT_MODEL`. They verify the JWT with Go before calling the model provider. The assistant is read-only and permits at most two post searches across three model calls.

The delivered local configuration keeps `ENABLE_PAID_AI=false`. The server rejects paid requests even if a key is present; browsing, search, uploads, and post management remain available. Keys belong in the ignored local environment file, never in source or `NEXT_PUBLIC_*` settings.

## Validation

```bash
npm test
npm run lint
npm run build
```

The regression suite covers client API contracts, safe backend proxy routing, media/range handling, account and publishing workflows, session expiry, deletion confirmation, optional AI behavior, and paid-feature shutdown. AI tests use mocked responses and do not consume paid API calls.
