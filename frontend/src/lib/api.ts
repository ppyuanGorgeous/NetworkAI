export interface Post {
  id: string;
  user: string;
  message: string;
  url: string;
  type: "image" | "video";
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

async function request(path: string, token: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`/api/backend${path}`, {
    ...init, headers, cache: "no-store", signal: init.signal ?? AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    const message = (await response.text()).trim();
    throw new ApiError(response.status === 401 ? path === "/signin" ? "The username or password is incorrect." : "Your session has expired. Please sign in again." :
      message.slice(0, 250) || `Request failed (${response.status}).`, response.status);
  }
  return response;
}

export async function signIn(username: string, password: string): Promise<string> {
  const response = await request("/signin", null, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return response.text();
}

export async function signUp(username: string, password: string): Promise<void> {
  await request("/signup", null, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, age: 0, gender: "unspecified" }),
  });
}

export async function searchPosts(token: string, filter: { keywords?: string; user?: string } = {}, signal?: AbortSignal): Promise<Post[]> {
  const query = new URLSearchParams();
  if (filter.user) query.set("user", filter.user);
  else if (filter.keywords) query.set("keywords", filter.keywords);
  const response = await request(`/posts/search?${query}`, token, { signal });
  const result: unknown = await response.json();
  if (!Array.isArray(result) || result.some((post) => !post || typeof post.id !== "string" || typeof post.message !== "string" || typeof post.user !== "string" || typeof post.url !== "string")) {
    throw new ApiError("The server returned an invalid feed. Please try again.", 502);
  }
  return result;
}

export async function publishPost(token: string, message: string, file: File): Promise<Post> {
  const body = new FormData();
  body.set("message", message.trim());
  body.set("media_file", file);
  const response = await request("/posts", token, { method: "POST", body });
  return response.json();
}

export async function deletePost(token: string, id: string): Promise<void> {
  await request(`/posts/${encodeURIComponent(id)}`, token, { method: "DELETE" });
}

export function mediaUrl(url: string): string | null {
  if (url.startsWith("/api/backend/media/")) return url;
  if (url.startsWith("/media/")) return `/api/backend${url}`;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? url : null;
  } catch { return null; }
}

export function validateMedia(file: File): string | null {
  if (!/\.(jpe?g|png|gif|webp|mp4|mov|webm)$/i.test(file.name)) return "Choose a JPEG, PNG, GIF, WebP, MP4, MOV, or WebM file.";
  if (file.size === 0) return "Choose a file that is not empty.";
  if (file.size > 28 * 1024 * 1024) return "Choose a file smaller than 28 MB.";
  return null;
}
