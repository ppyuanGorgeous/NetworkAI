import { connection } from 'next/server';
import { capabilities } from '@/lib/server/ai';
export async function GET() {
  await connection();
  return Response.json(capabilities(), { headers: { 'Cache-Control': 'no-store' } });
}
