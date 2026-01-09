"use client";
import React from "react";
import AppShell from "../../components/AppShell";

export default function Veo3ComingSoonPage() {
  return (
    <AppShell
      selectedTool="veo3"
      showMobilePrompt={false}
      showLeftSidebar={false}
      onCreditsUpdate={() => {}}
      childrenMain={
        <div className="max-w-4xl mx-auto py-16">
          <div className="bg-[#18181b] rounded-lg p-12 border border-white/20 text-center">
            <div className="mb-8">
              <div className="w-24 h-24 bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <span className="text-4xl">🚧</span>
              </div>
              <h1 className="text-4xl font-bold mb-4 text-white">Coming Soon</h1>
              <h2 className="text-2xl font-semibold mb-6 text-yellow-400">Google Veo 3 Video Generation</h2>
            </div>
            <div className="max-w-2xl mx-auto space-y-6">
              <p className="text-xl text-gray-300 mb-8">
                We're working hard to bring you the latest Google Veo 3 AI video generation technology.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <a href="/video/veo31" className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-8 rounded-lg transition-colors">Try Veo 3.1</a>
                <a href="/" className="bg-gray-600 hover:bg-gray-700 text-white font-semibold py-3 px-8 rounded-lg transition-colors">Back to Homepage</a>
              </div>
            </div>
          </div>
        </div>
      }
    />
  );
}