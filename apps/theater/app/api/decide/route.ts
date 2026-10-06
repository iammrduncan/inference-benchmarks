import { getRuntime } from '../../../lib/server';
import { localRequest, readInput } from '../../../lib/request';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  if (!localRequest(request, true)) return Response.json({ error: 'Open the local demo app to run a request.' }, { status: 403 });
  try {
    const demo = await getRuntime();
    if (request.headers.get('x-demo-token') !== demo.config().token) return Response.json({ error: 'Invalid demo session.' }, { status: 403 });
    const result = await demo.run(await readInput(request), request.signal);
    return Response.json(result.body, { status: result.status, headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'Invalid or unavailable demo request. No action applied.' }, { status: 400 }); }
}
