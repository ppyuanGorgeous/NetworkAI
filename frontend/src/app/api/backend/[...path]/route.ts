import { forwardBackend } from "@/lib/backend-proxy";

async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return forwardBackend(request, (await context.params).path);
}
export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const DELETE = handle;
