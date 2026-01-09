import React from "react";
import { FaArrowRight, FaDiscord } from "react-icons/fa";
import AppShell from "./components/AppShell";
import Link from "next/link";
import ShowcaseGrid from "./components/ShowcaseGrid";
import {sanityClient} from "../sanity/lib/client";
import {SHOWCASE_QUERY, FEATURED_TOOLS_QUERY} from "../sanity/lib/queries";
import {urlFor} from "../sanity/lib/image";

export const revalidate = 60;

export default async function HomePage() {
  let initialItems = [];
  let featuredTools = [];
  
  try {
    console.log('Fetching showcase items...');
    const result = await sanityClient.fetch(SHOWCASE_QUERY);
    initialItems = Array.isArray(result) ? result : [];
    console.log('Final items array length:', initialItems.length);
  } catch (error) {
    console.error('Failed to fetch showcase items:', error);
  }

  try {
    console.log('Fetching featured tools...');
    const tools = await sanityClient.fetch(FEATURED_TOOLS_QUERY);
    featuredTools = Array.isArray(tools) ? tools : [];
    console.log('Featured tools length:', featuredTools.length);
  } catch (error) {
    console.error('Failed to fetch featured tools:', error);
  }
  
  return (
    <AppShell
      selectedTool="home"
      showMobilePrompt={false}
      showLeftSidebar={false}
      childrenMain={
        <div className="min-h-screen bg-black text-white">
          {/* Main Content */}
          <div className="w-full px-3 md:px-6 py-8 flex flex-col">
            {/* Section 1: Featured Tools */}
            <div className="order-2 md:order-1 mb-12">
              <h2 className="text-4xl font-bold mb-6 text-yellow-400">COOL TOOLS</h2>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {featuredTools.length > 0 ? (
                  featuredTools.map((tool) => {
                    const getGradientClasses = (color) => {
                      switch (color) {
                        case 'purple':
                          return 'from-purple-900/20 to-blue-900/20 from-purple-600/30 to-blue-600/30';
                        case 'green':
                          return 'from-green-900/20 to-teal-900/20 from-green-600/30 to-teal-600/30';
                        case 'orange':
                          return 'from-orange-900/20 to-red-900/20 from-orange-600/30 to-red-600/30';
                        default:
                          return 'from-purple-900/20 to-blue-900/20 from-purple-600/30 to-blue-600/30';
                      }
                    };
                    
                    const [bgGradient, overlayGradient] = getGradientClasses(tool.gradientColor).split(' ');
                    
                    return (
                      <div key={tool._id}>
                        <Link href={tool.linkHref} className="group block">
                          <div className={`relative aspect-video rounded-lg overflow-hidden bg-gradient-to-br ${bgGradient} hover:scale-105 transition-all duration-300`}>
                            {/* Background Media */}
                            {tool.mediaType === 'image' && tool.backgroundImage && (
                              <div 
                                className="absolute inset-0 bg-cover bg-center bg-no-repeat"
                                style={{
                                  backgroundImage: `url(${urlFor(tool.backgroundImage)?.width(800).height(450).fit('crop').auto('format').url()})`
                                }}
                              />
                            )}
                            {tool.mediaType === 'video' && tool.backgroundVideoUrl && (
                              <video
                                className="absolute inset-0 w-full h-full object-cover"
                                src={tool.backgroundVideoUrl}
                                muted
                                playsInline
                                loop
                                autoPlay
                                preload="metadata"
                              />
                            )}
                            
                            {/* Overlay */}
                            <div 
                              className={`absolute inset-0 bg-gradient-to-r ${overlayGradient} ${tool.mediaType !== 'gradient' ? 'bg-black' : ''}`}
                              style={tool.mediaType !== 'gradient' ? {opacity: `${tool.overlayOpacity || 40}%`} : {}}
                            ></div>
                            
                            {/* Content */}
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="text-center p-6 w-full">
                                <div className="font-bold text-white mb-2 leading-tight break-words text-balance text-[clamp(1.25rem,4vw,2rem)] md:text-[clamp(1.5rem,3vw,2.25rem)] lg:text-[clamp(1.75rem,2.5vw,2.5rem)]">
                                  {tool.title}
                                </div>
                                {tool.subtitle1 && (
                                  <div className="text-white/90 mb-2 text-sm md:text-base lg:text-lg leading-snug">
                                    {tool.subtitle1}
                                  </div>
                                )}
                                {tool.subtitle2 && (
                                  <div className="text-white/90 text-sm md:text-base lg:text-lg leading-snug">
                                    {tool.subtitle2}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </Link>
                        <div className="mt-4 text-left">
                          <div className="text-sm text-white/90 mb-1">{tool.description}</div>
                          <Link href={tool.linkHref} className="inline-flex items-center text-lg font-bold text-white hover:text-yellow-300 transition-colors">
                            {tool.boldText}
                            <FaArrowRight className="ml-2 text-yellow-400" />
                          </Link>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  // Fallback cards if no tools in Sanity
                  <>
                    <div>
                      <div className="relative aspect-video rounded-lg overflow-hidden bg-gradient-to-br from-purple-900/20 to-blue-900/20">
                        <div className="absolute inset-0 bg-gradient-to-r from-purple-600/30 to-blue-600/30"></div>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="text-center p-6">
                            <div className="text-2xl font-bold text-white mb-2">UNLIMITED Sora 2 Trends</div>
                            <div className="text-lg text-white/90 mb-2">Full Creative Control</div>
                            <div className="text-lg text-white/90">25+ Presets</div>
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 text-left">
                        <div className="text-sm text-white/90 mb-1">The World's Most Viral Presets, All in One Place</div>
                        <div className="text-lg font-bold text-white flex items-center">
                          HIGGSFIELD TRENDS POWERED BY SORA 2
                          <FaArrowRight className="ml-2 text-yellow-400" />
                        </div>
                      </div>
                    </div>
                    <div>
                      <div className="relative aspect-video rounded-lg overflow-hidden bg-gradient-to-br from-green-900/20 to-teal-900/20">
                        <div className="absolute inset-0 bg-gradient-to-r from-green-600/30 to-teal-600/30"></div>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="text-center p-6">
                            <div className="text-2xl font-bold text-white mb-2">Higgsfield x OpenAI</div>
                            <div className="text-lg text-white/90 mb-2">SORA 2</div>
                            <div className="text-lg text-white/90">UNLIMITED</div>
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 text-left">
                        <div className="text-sm text-white/90 mb-1">The Most Hyped Video Model by OpenAI</div>
                        <div className="text-lg font-bold text-white flex items-center">
                          UNLIMITED SORA 2
                          <FaArrowRight className="ml-2 text-yellow-400" />
                        </div>
                      </div>
                    </div>
                    <div>
                      <div className="relative aspect-video rounded-lg overflow-hidden bg-gradient-to-br from-orange-900/20 to-red-900/20">
                        <div className="absolute inset-0 bg-gradient-to-r from-orange-600/30 to-red-600/30"></div>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="text-center p-6">
                            <div className="text-2xl font-bold text-white mb-2">UNLIMITED WAN 2.5</div>
                            <div className="flex items-center justify-center space-x-2 mb-2">
                              <div className="w-8 h-8 bg-white/20 rounded-full"></div>
                              <div className="w-8 h-8 bg-white/20 rounded-full"></div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 text-left">
                        <div className="text-sm text-white/90 mb-1">Next-gen video + audio, mastered without limits</div>
                        <div className="text-lg font-bold text-white flex items-center">
                          WAN 2.5 UNLIMITED WITH SYNCED AUDIO
                          <FaArrowRight className="ml-2 text-yellow-400" />
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Section 2: Community Showcase */}
            <div className="order-1 md:order-2 mb-8">
              <h2 className="text-4xl font-bold mb-6 text-yellow-400">COOL TEMPLATES</h2>
              <ShowcaseGrid initialItems={initialItems} />
            </div>
          </div>
        </div>
      }
    />
  );
} 