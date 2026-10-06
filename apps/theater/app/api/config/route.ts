import { getRuntime } from '../../../lib/server';
import { localRequest } from '../../../lib/request';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!localRequest(request)) return Response.json({ error: 'Local access only.' }, { status: 403 });
  try { return Response.json((await getRuntime()).config(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: 'Demo runtime unavailable. Check server configuration.' }, { status: 503 }); }
}
