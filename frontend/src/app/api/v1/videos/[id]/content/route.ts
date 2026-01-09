export const runtime = 'edge';
export const preferredRegion = ['iad1', 'sfo1'];

export async function GET(_: Request, context: any) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return new Response('OPENAI_API_KEY not configured', { status: 500 });
    const { id } = (context || {}).params || {};
    const upstream = await fetch(`https://api.openai.com/v1/videos/${encodeURIComponent(id)}/content`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store'
    });
    // Stream body directly to client
    const headers = new Headers(upstream.headers);
    headers.set('access-control-allow-origin', '*');
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (e: any) {
    return new Response(e?.message || 'Proxy error', { status: 500 });
  }
}


