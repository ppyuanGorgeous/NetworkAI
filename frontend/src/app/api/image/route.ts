import { handleImage } from '@/lib/server/ai';
export async function POST(request: Request) { return handleImage(request); }
