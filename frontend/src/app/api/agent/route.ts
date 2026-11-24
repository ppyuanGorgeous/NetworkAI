import { handleAgent } from '@/lib/server/ai';
export async function POST(request: Request) { return handleAgent(request); }
