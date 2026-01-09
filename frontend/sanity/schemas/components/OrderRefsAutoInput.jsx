import React, {useEffect, useMemo, useState} from 'react'
import {useClient, useFormValue} from 'sanity'
import {set} from 'sanity'

export default function OrderRefsAutoInput(props) {
  const {value, onChange} = props
  const client = useClient({apiVersion: '2023-10-10', perspective: 'previewDrafts'})
  const formDocId = useFormValue(['_id'])
  const [refs, setRefs] = useState([])
  const [loading, setLoading] = useState(false)

  const sectionId = typeof formDocId === 'string' ? formDocId : undefined

  const fetchRefs = async () => {
    if (!sectionId) { setLoading(false); return }
    setLoading(true)
    try {
      const sectionIdPub = String(sectionId || '').replace(/^drafts\./, '')
      const sectionIdDraft = `drafts.${sectionIdPub}`
      const query = `*[_type == "showcaseItem" && (references($pub) || references($draft))]{ _id, title, publishedAt } | order(publishedAt desc)`
      const params = {pub: sectionIdPub, draft: sectionIdDraft}
      // eslint-disable-next-line no-console
      console.log('[OrderRefs] Query params', params)
      const data = await client.fetch(query, params)
      // eslint-disable-next-line no-console
      console.log('[OrderRefs] Found', Array.isArray(data) ? data.length : 0)
      setRefs(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRefs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId, document?._rev])

  // Removed auto-initialize to avoid patching read-only docs; use explicit Sync button instead

  const ordered = useMemo(() => {
    const orderIndex = new Map((value || []).map((r, i) => [r?._ref, i]))
    const inOrder = [...refs].sort((a, b) => {
      const ia = orderIndex.has(a._id) ? orderIndex.get(a._id) : Number.MAX_SAFE_INTEGER
      const ib = orderIndex.has(b._id) ? orderIndex.get(b._id) : Number.MAX_SAFE_INTEGER
      return ia - ib
    })
    return inOrder
  }, [value, refs])

  const move = (idToMove, dir) => {
    const currentRefs = Array.isArray(value) ? value : []
    const prevKeyByRef = new Map(currentRefs.map((r) => [r?._ref, r?._key]))
    const current = currentRefs.map((r) => r?._ref)
    // Ensure all referenced ids are present in the value array first
    const ensure = refs.map((r) => r._id)
    let arr = current.length ? current.slice() : ensure.slice()
    // Filter to only ids that are still referenced
    arr = arr.filter((id) => ensure.includes(id))
    if (!arr.includes(idToMove)) arr.push(idToMove)
    const idx = arr.indexOf(idToMove)
    const newIdx = Math.max(0, Math.min(arr.length - 1, idx + dir))
    arr.splice(idx, 1)
    arr.splice(newIdx, 0, idToMove)
    const next = arr.map((id) => ({
      _type: 'reference',
      _ref: id,
      _key: prevKeyByRef.get(id) || id,
    }))
    onChange(set(next))
  }

  return (
    <div style={{border: '1px solid var(--card-border-color, #333)', borderRadius: 6, padding: 8}}>
      <div style={{marginBottom: 8, opacity: 0.8, fontSize: 12}}>
        Items shown are auto-synced from Showcase Items tagged with this section. Dragging is simplified to Up/Down controls below.
      </div>
      {loading ? (
        <div style={{opacity: 0.7}}>Loading…</div>
      ) : ordered.length === 0 ? (
        <div style={{opacity: 0.7}}>No tagged items yet for {String(sectionId || '')}. Add this section to a Showcase Item to see it here.</div>
      ) : (
        <ul style={{listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6}}>
          {ordered.map((r) => (
            <li key={r._id} style={{display: 'flex', alignItems: 'center', gap: 8}}>
              <div style={{flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{r.title?.[0]?.children?.[0]?.text || r.title || r._id}</div>
              <button type="button" onClick={() => move(r._id, -1)} style={{padding: '4px 8px'}}>↑</button>
              <button type="button" onClick={() => move(r._id, 1)} style={{padding: '4px 8px'}}>↓</button>
            </li>
          ))}
        </ul>
      )}
      <div style={{marginTop: 8, display: 'flex', gap: 8}}>
        <button type="button" onClick={fetchRefs} style={{padding: '4px 8px'}}>Refresh</button>
        <button
          type="button"
          onClick={() => {
            const prevKeyByRef = new Map((value || []).map((r) => [r?._ref, r?._key]))
            const next = refs.map((r) => ({
              _type: 'reference',
              _ref: r._id,
              _key: prevKeyByRef.get(r._id) || r._id,
            }))
            onChange(set(next))
          }}
          style={{padding: '4px 8px'}}
        >
          Sync order from tags
        </button>
      </div>
    </div>
  )
}


