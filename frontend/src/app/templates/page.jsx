import React from "react";
import AppShell from "../components/AppShell";
import ShowcaseGrid, { Media } from "../components/ShowcaseGrid";
import HorizontalScroller from "../components/HorizontalScroller";
import HorizontalInfiniteScroller from "../components/HorizontalInfiniteScroller";
import Link from "next/link";
import { FaHeart } from "react-icons/fa";
import { PortableText } from "@portabletext/react";
import { sanityClient } from "../../sanity/lib/client";
import { TEMPLATE_SECTIONS_WITH_ITEMS_QUERY, SHOWCASE_QUERY } from "../../sanity/lib/queries";

export const revalidate = 60;

export default async function TemplatesPage() {
  const client = sanityClient.withConfig({ useCdn: false });
  let sections = [];
  let items = [];
  try {
    console.log('[Templates] Fetching sections...');
    const sec = await client.fetch(TEMPLATE_SECTIONS_WITH_ITEMS_QUERY);
    sections = Array.isArray(sec) ? sec : [];
    console.log('[Templates] Sections length:', sections.length, sections.map(s => ({ title: s?.title, items: Array.isArray(s?.items) ? s.items.length : 0 })));
    if (sections.length === 0) {
      console.log('[Templates] No sections returned. Falling back to items-by-tags');
      const result = await client.fetch(SHOWCASE_QUERY);
      items = Array.isArray(result) ? result : [];
      console.log('[Templates] Items length:', items.length);
    }
  } catch (err) {
    console.error('[Templates] Error fetching sections/items', err);
  }

  const byTag = (tag) => items.filter((it) => Array.isArray(it?.tags) && it.tags.map((t)=>String(t).toLowerCase()).includes(tag.toLowerCase()));
  const trending = sections.length === 0 ? (byTag('trending').length ? byTag('trending') : []) : [];
  const groupSelfies = sections.length === 0 ? (byTag('group').length ? byTag('group') : byTag('group-selfie').length ? byTag('group-selfie') : []) : [];
  const influencer = sections.length === 0 ? (byTag('influencer').length ? byTag('influencer') : []) : [];

  // Derive dynamic tag-based sections if no explicit sections exist
  let derivedTagSections = [];
  if (sections.length === 0) {
    const tagToItems = new Map();
    for (const it of items) {
      const tags = Array.isArray(it?.tags) ? it.tags : [];
      for (const raw of tags) {
        const t = String(raw).trim();
        if (!t) continue;
        if (!tagToItems.has(t)) tagToItems.set(t, []);
        tagToItems.get(t).push(it);
      }
    }
    // Optional: prioritize some common sections
    const priority = ["Trending", "Group Selfies", "Influencer"]; 
    const titleCase = (s) => s.replace(/[-_]+/g,' ').replace(/\s+/g,' ').trim().replace(/\b\w/g, c => c.toUpperCase());
    const entries = Array.from(tagToItems.entries())
      .map(([tag, arr]) => ({ title: titleCase(tag), items: arr }))
      .filter((s) => s.items.length > 0);
    entries.sort((a,b)=>{
      const ia = priority.indexOf(a.title);
      const ib = priority.indexOf(b.title);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      return a.title.localeCompare(b.title);
    });
    derivedTagSections = entries;
  }

  return (
    <AppShell
      selectedTool="templates"
      showLeftSidebar={false}
      showMobilePrompt={false}
      childrenMain={
        <div className="min-h-screen bg-black text-white">
          <div className="w-full px-3 md:px-6 py-8 flex flex-col gap-12">
            {sections.length > 0 ? (
              sections.map((sec) => {
                const orderMap = new Map((sec.orderRefs || []).map((id, idx) => [id, idx]))
                const ordered = (sec.items || []).slice().sort((a, b) => {
                  const ia = orderMap.has(a._id) ? orderMap.get(a._id) : Infinity
                  const ib = orderMap.has(b._id) ? orderMap.get(b._id) : Infinity
                  if (ia !== ib) return ia - ib
                  // fallback: publishedAt desc
                  const ad = a.publishedAt || '1970-01-01'
                  const bd = b.publishedAt || '1970-01-01'
                  return bd.localeCompare(ad)
                })
                return (
                  <SectionRow key={sec._id} title={sec.title} items={ordered} speed={typeof sec.autoScrollSpeed === 'number' ? sec.autoScrollSpeed : 0.6} />
                )
              })
            ) : (
              <>
                {derivedTagSections.length > 0 ? (
                  derivedTagSections.map((s) => (
                    <SectionRow key={s.title} title={s.title} items={s.items} />
                  ))
                ) : (
                  <>
                    <SectionRow title="TRENDING" items={trending} />
                    <SectionRow title="GROUP SELFIES" items={groupSelfies} />
                    <SectionRow title="INFLUENCER" items={influencer} />
                  </>
                )}
              </>
            )}
          </div>
        </div>
      }
    />
  );
}

function SectionRow({ title, items, speed = 0.6 }) {
  return (
    <section>
      <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold mb-4 text-yellow-400">{title}</h2>
      <HorizontalInfiniteScroller autoScroll={true} speed={speed}>
        {items.map((item) => (
          <Card key={item._id} item={item} />
        ))}
      </HorizontalInfiniteScroller>
    </section>
  );
}

function Card({ item }) {
  const href = (() => {
    const tool = String(item.tool || '').toLowerCase();
    const slug = String(item.templateSlug || '').toLowerCase();
    if (tool && slug) {
      if (tool === 'seedream4') return `/image/seedream4?template=${encodeURIComponent(slug)}`;
      if (tool === 'seedance') return `/video/seedance?template=${encodeURIComponent(slug)}`;
    }
    return item.linkHref || '#';
  })();
  const validHref = Boolean(href && href !== '#');

  return (
    <div className="w-[42vw] sm:w-[36vw] md:w-[28vw] lg:w-[22vw] xl:w-[18vw] max-w-[340px] flex-shrink-0">
      {validHref ? (
        <Link href={href} className="block">
          <div className="relative aspect-[4/5] overflow-hidden rounded-lg bg-gray-800/50 hover:scale-105 transition-all duration-300">
            <Media item={item} />
            <div className="absolute inset-x-0 top-0 pointer-events-none">
              <div className="bg-gradient-to-b from-black/70 to-transparent px-3 pt-3 pb-8">
                <div className="text-white font-medium text-sm md:text-base line-clamp-2">
                  <PortableText value={item.title} />
                </div>
              </div>
            </div>
          </div>
        </Link>
      ) : (
        <div className="relative aspect-[4/5] overflow-hidden rounded-lg bg-gray-800/50">
          <Media item={item} />
          <div className="absolute inset-x-0 top-0 pointer-events-none">
            <div className="bg-gradient-to-b from-black/70 to-transparent px-3 pt-3 pb-8">
              <div className="text-white font-medium text-sm md:text-base line-clamp-2">
                <PortableText value={item.title} />
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="mt-2">
        <a
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-white/10 text-white font-semibold py-2 active:scale-95 transition-all hover:bg-white/20"
          href={validHref ? href : undefined}
        >
          <FaHeart className="text-pink-500" />
          Try
        </a>
      </div>
    </div>
  );
}


