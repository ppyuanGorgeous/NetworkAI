import { afterEach, expect, it, vi } from "vitest";
import { forwardBackend } from "./backend-proxy";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("only forwards known routes and never turns the proxy into an arbitrary URL fetcher", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect((await forwardBackend(new Request("http://localhost/api/backend/evil"), ["http:", "evil.example"])).status).toBe(404);
  expect((await forwardBackend(new Request("http://localhost/api/backend/media/a"), ["media", "..", "config"])).status).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
});
it("forwards authentication, queries and response status without cookies or caching", async () => {
  vi.stubEnv("INTERNAL_API_URL", "http://backend:8080");
  const fetch = vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 })); vi.stubGlobal("fetch", fetch);
  const response = await forwardBackend(new Request("http://localhost/api/backend/posts/search?keywords=design", { headers: { Authorization: "Bearer token", Cookie: "private=value" } }), ["posts", "search"]);
  expect(String(fetch.mock.calls[0][0])).toBe("http://backend:8080/posts/search?keywords=design");
  expect(fetch.mock.calls[0][1].headers.get("Authorization")).toBe("Bearer token");
  expect(fetch.mock.calls[0][1].headers.has("Cookie")).toBe(false);
  expect(response.status).toBe(401);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});
it("supports media range responses for real video playback", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("partial", { status: 206, headers: { "Content-Range": "bytes 0-6/20", "Content-Type": "video/mp4" } })); vi.stubGlobal("fetch", fetch);
  const response = await forwardBackend(new Request("http://localhost/api/backend/media/a.mp4", { headers: { Range: "bytes=0-6" } }), ["media", "a.mp4"]);
  expect(fetch.mock.calls[0][1].headers.get("Range")).toBe("bytes=0-6");
  expect(response.status).toBe(206);
  expect(response.headers.get("Content-Range")).toBe("bytes 0-6/20");
});
it("returns a recoverable error if the local backend is offline", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  const response = await forwardBackend(new Request("http://localhost/api/backend/healthz"), ["healthz"]);
  expect(response.status).toBe(502);
  expect(await response.text()).toContain("local service is unavailable");
});
