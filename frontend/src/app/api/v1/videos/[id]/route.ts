export const runtime = 'edge';
export const preferredRegion = ['iad1', 'sfo1'];

export async function GET(_: Request, context: any) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }), { status: 500 });
    const { id } = (context || {}).params || {};
    const upstream = await fetch(`https://api.openai.com/v1/videos/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store'
    });
    const body = await upstream.arrayBuffer();
    const headers = new Headers(upstream.headers);
    headers.set('access-control-allow-origin', '*');
    return new Response(body, { status: upstream.status, headers });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'Proxy error' }), { status: 500 });
  }
}


