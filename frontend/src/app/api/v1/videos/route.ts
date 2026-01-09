export const runtime = 'edge';
export const preferredRegion = ['iad1', 'sfo1'];

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }), { status: 500 });
    }

    // Forward multipart form-data body as-is
    const form = await req.formData();
    const upstream = await fetch('https://api.openai.com/v1/videos', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form as unknown as BodyInit,
    });

    const body = await upstream.arrayBuffer();
    const headers = new Headers(upstream.headers);
    headers.set('access-control-allow-origin', '*');
    return new Response(body, { status: upstream.status, headers });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'Proxy error' }), { status: 500 });
  }
}

export const OPTIONS = () => new Response(null, {
  status: 204,
  headers: {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
  },
});


