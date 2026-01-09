import {sanityClient} from '../../../sanity/lib/client'
import {SHOWCASE_QUERY} from '../../../sanity/lib/queries'

export async function GET(request) {
  const {searchParams} = new URL(request.url)
  const limit = Math.min(Number(searchParams.get('limit') || 24), 60)
  const offset = Math.max(Number(searchParams.get('offset') || 0), 0)
  const data = await sanityClient.fetch(SHOWCASE_QUERY, {from: offset, to: offset + limit})
  return Response.json({items: data, nextOffset: offset + data.length})
}


