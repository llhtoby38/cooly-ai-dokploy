import {revalidatePath} from 'next/cache'

export async function POST(request) {
  const {searchParams} = new URL(request.url)
  if (searchParams.get('secret') !== process.env.REVALIDATE_SECRET) {
    return new Response('Unauthorized', {status: 401})
  }
  // Optional JSON body: { paths: ["/templates", "/"] }
  try {
    const body = await request.json().catch(() => null)
    const paths = Array.isArray(body?.paths) ? body.paths : null
    if (paths && paths.length) {
      for (const p of paths) {
        if (typeof p === 'string' && p.startsWith('/')) revalidatePath(p)
      }
    } else {
      // Default: revalidate key routes
      revalidatePath('/')
      revalidatePath('/templates')
    }
  } catch {}
  return Response.json({revalidated: true})
}


