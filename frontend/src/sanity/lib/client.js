import {createClient} from 'next-sanity'

const projectId = (process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || process.env.SANITY_PROJECT_ID || 'zlcfuo6a').trim()
const dataset = (process.env.NEXT_PUBLIC_SANITY_DATASET || process.env.SANITY_DATASET || 'production').trim()
const apiVersion = (process.env.NEXT_PUBLIC_SANITY_API_VERSION || '2025-01-01').trim()

if (!projectId) {
  const available = Object.keys(process.env).filter((k) => k.toLowerCase().includes('sanity'))
  throw new Error(
    `Sanity projectId is missing. Set NEXT_PUBLIC_SANITY_PROJECT_ID (or SANITY_PROJECT_ID) in your environment. Available SANITY* keys: ${available.join(', ')}`
  )
}

// Public client for reading published content (no authentication required)
export const sanityClient = createClient({
  projectId,
  dataset,
  apiVersion,
  useCdn: true,
  perspective: 'published',
})


