const maximumBody = 33 * 1024 * 1024;

export async function forwardBackend(request: Request, path: string[]): Promise<Response> {
  const route = path.join("/");
  const allowed =
    (request.method === "POST" && ["signup", "signin", "posts"].includes(route)) ||
    (request.method === "GET" && ["posts/search", "healthz"].includes(route)) ||
    (request.method === "DELETE" && /^posts\/[a-zA-Z0-9_-]+$/.test(route)) ||
    (["GET", "HEAD"].includes(request.method) && /^media\/[a-zA-Z0-9_.-]+$/.test(route));
  if (!allowed) return new Response("Not found", { status: 404 });
  if (Number(request.headers.get("content-length")) > maximumBody) return new Response("Upload is too large", { status: 413 });
  const upstream = new URL(`/${route}`, process.env.INTERNAL_API_URL || "http://127.0.0.1:8080");
  upstream.search = new URL(request.url).search;
  const headers = new Headers();
  for (const name of ["authorization", "content-type", "range"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const body = request.method === "POST" ? await request.arrayBuffer() : undefined;
    if (body && body.byteLength > maximumBody) return new Response("Upload is too large", { status: 413 });
    const response = await fetch(upstream, {
      method: request.method, headers, body, cache: "no-store", redirect: "manual",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]),
    });
    const outgoing = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "www-authenticate"]) {
      const value = response.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    return new Response(request.method === "HEAD" || response.status === 204 ? null : response.body, { status: response.status, headers: outgoing });
  } catch {
    return new Response("The local service is unavailable. Please try again.", { status: 502 });
  }
}
