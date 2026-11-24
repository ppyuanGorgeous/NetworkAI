import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, deletePost, mediaUrl, publishPost, searchPosts, signIn, validateMedia } from "./api";
afterEach(() => { vi.unstubAllGlobals(); });
describe("authenticated API client", () => {
  it("encodes search terms and sends the actual bearer token", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json([]));
    vi.stubGlobal("fetch", fetch);
    expect(await searchPosts("test-token", { keywords: "code & design" })).toEqual([]);
    expect(fetch.mock.calls[0][0]).toBe("/api/backend/posts/search?keywords=code+%26+design");
    expect(fetch.mock.calls[0][1].headers.get("Authorization")).toBe("Bearer test-token");
  });
  it("matches the API's user-filter precedence", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json([])); vi.stubGlobal("fetch", fetch);
    await searchPosts("token", { user: "alice", keywords: "ignored" });
    expect(fetch.mock.calls[0][0]).toBe("/api/backend/posts/search?user=alice");
  });
  it("distinguishes invalid credentials from an expired protected session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("invalid", { status: 401 })));
    await expect(signIn("alice", "wrong")).rejects.toThrow("username or password");
    await expect(searchPosts("expired")).rejects.toMatchObject({ status: 401 });
  });
  it("rejects a malformed feed instead of inventing posts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ posts: [] })));
    await expect(searchPosts("token")).rejects.toBeInstanceOf(ApiError);
  });
  it("uses multipart field names expected by Go without overriding the boundary", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ id: "post-1" })); vi.stubGlobal("fetch", fetch);
    const file = new File(["test"], "idea.png", { type: "image/png" });
    await publishPost("token", "  My idea  ", file);
    const init = fetch.mock.calls[0][1];
    expect(init.body.get("message")).toBe("My idea");
    expect(init.body.get("media_file").name).toBe("idea.png");
    expect(init.headers.has("Content-Type")).toBe(false);
  });
  it("passes deletion failures back to the UI", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Post not found", { status: 404 })));
    await expect(deletePost("token", "post-1")).rejects.toMatchObject({ status: 404 });
  });
});
describe("media validation", () => {
  it("rejects empty and unsupported files", () => {
    expect(validateMedia(new File([], "empty.png"))).toContain("empty");
    expect(validateMedia(new File(["script"], "unsafe.html"))).toContain("Choose a JPEG");
    expect(validateMedia(new File(["image"], "photo.webp"))).toBeNull();
  });
  it("maps local media to the same-origin proxy and refuses unsafe URL schemes", () => {
    expect(mediaUrl("/media/post-1.png")).toBe("/api/backend/media/post-1.png");
    expect(mediaUrl("/api/backend/media/post-1.png")).toBe("/api/backend/media/post-1.png");
    expect(mediaUrl("javascript:alert(1)")).toBeNull();
    expect(mediaUrl("https://storage.googleapis.com/bucket/photo.png")).toContain("https://");
  });
});
