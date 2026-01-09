'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {PortableText} from '@portabletext/react'
import {urlFor} from '../../sanity/lib/image'
import { FaHeart } from 'react-icons/fa'

export default function ShowcaseGrid({initialItems = []}) {
  const items = initialItems
  const router = useRouter()

  // If no items, show some placeholder content
  if (items.length === 0) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {Array.from({length: 20}).map((_, i) => (
          <div key={i} className="aspect-[4/5] bg-gray-800/50 rounded-lg animate-pulse">
            <div className="w-full h-full bg-gradient-to-br from-gray-700/50 to-gray-800/50 rounded-lg"></div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {items.map((item) => {
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
          <div key={item._id} className="relative">
            {validHref ? (
              <Link href={href} className="block group relative">
            <div className="relative aspect-[4/5] overflow-hidden rounded-lg bg-gray-800/50 hover:scale-105 transition-all duration-300">
              <Media item={item} />
                  {/* Persistent top gradient for text readability */}
                  <div className="absolute inset-x-0 top-0 pointer-events-none">
                    <div className="bg-gradient-to-b from-black/70 to-transparent px-3 pt-3 pb-8">
                      <div className="text-white font-medium">
                    <PortableText 
                      value={item.title} 
                      components={{
                        block: {
                          normal: ({children, value}) => {
                            const style = value?.style || 'normal';
                                const alignment = value?.textAlign || 'left';
                                const getSizeClass = (s) => {
                                  switch(s){
                                    case 'h1': return 'text-lg md:text-2xl';
                                    case 'h2': return 'text-base md:text-xl';
                                    case 'h3': return 'text-sm md:text-lg';
                                    default: return 'text-sm md:text-base';
                                  }
                                };
                                const alignClass = alignment === 'right' ? 'text-right' : alignment === 'center' ? 'text-center' : 'text-left';
                              const fontMap = {
                                  helvetica: 'Helvetica, Arial, sans-serif', arial: 'Arial, sans-serif', times: 'Times New Roman, Times, serif', courier: 'Courier New, Courier, monospace', georgia: 'Georgia, serif', verdana: 'Verdana, sans-serif', tahoma: 'Tahoma, sans-serif', trebuchet: 'Trebuchet MS, sans-serif', comic: 'Comic Sans MS, cursive', impact: 'Impact, sans-serif', lucida: 'Lucida Console, Monaco, monospace', palatino: 'Palatino, Palatino Linotype, serif',
                            };
                            return (
                                  <div className={`${getSizeClass(style)} ${alignClass}`} style={{fontFamily: fontMap[item.titleFontFamily] || 'Helvetica, Arial, sans-serif'}}>
                                {children}
                              </div>
                            );
                          },
                        },
                      }}
                    />
                  </div>
                  {item.caption?.length && (
                        <div className="text-white/90 text-xs md:text-sm mt-1 line-clamp-2">
                      <PortableText value={item.caption} />
                    </div>
                  )}
                    </div>
                  </div>
                </div>
              </Link>
            ) : (
              <div className="group relative">
                <div className="relative aspect-[4/5] overflow-hidden rounded-lg bg-gray-800/50">
                  <Media item={item} />
                  <div className="absolute inset-x-0 top-0 pointer-events-none">
                    <div className="bg-gradient-to-b from-black/70 to-transparent px-3 pt-3 pb-8">
                      <div className="text-white font-medium">
                        <PortableText value={item.title} />
                      </div>
                      {item.caption?.length && (
                        <div className="text-white/90 text-xs md:text-sm mt-1 line-clamp-2">
                          <PortableText value={item.caption} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
              
            {/* Action bar below card (all breakpoints) */}
            <div className="mt-2">
                <button 
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-white/10 text-white font-semibold py-2 active:scale-95 transition-all hover:bg-white/20"
                onClick={(e)=>{ e.preventDefault(); if (href && href !== '#') router.push(href); }}
              >
                <FaHeart className="text-pink-500" />
                Try
                </button>
            </div>
          </div>
          );
        })}
      </div>
    </div>
  )
}

export function Media({item}) {
  if (item.mediaType === 'video' && item.videoUrl) {
    return (
      <video
        src={item.videoUrl}
        poster={item.image ? urlFor(item.image)?.width(400).height(500).fit('crop').auto('format').url() : undefined}
        muted 
        playsInline 
        loop 
        autoPlay
        preload="metadata" 
        draggable={false}
        className="w-full h-full object-cover select-none no-drag"
      />
    )
  }
  
  const src = item.image ? urlFor(item.image)?.width(400).height(500).fit('crop').auto('format').url() : ''
  
  if (!src) {
    return (
      <div className="w-full h-full bg-gradient-to-br from-gray-700/50 to-gray-800/50 flex items-center justify-center">
        <div className="text-gray-500 text-sm">No image</div>
      </div>
    )
  }
  
  return (
    <img 
      src={src} 
      alt={item.title} 
      draggable={false}
      className="w-full h-full object-cover select-none no-drag" 
    />
  )
}


