'use client';

import React from 'react';
import { FaWhatsapp } from 'react-icons/fa6';
import { BookOpen, ExternalLink, Activity, ShieldCheck } from 'lucide-react';

interface HeaderProps {
  apiKey?: string;
  apiBase?: string;
}

export const Header: React.FC<HeaderProps> = ({ apiBase = '' }) => {
  const docsUrl = apiBase ? `${apiBase}/docs` : '/docs';
  const metricsUrl = apiBase ? `${apiBase}/metrics` : '/metrics';

  return (
    <header className="bg-white sticky top-0 z-40 border-b border-[#E9EDEF] px-6 py-3.5 shadow-xs">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center space-x-3.5">
          <div className="w-10 h-10 rounded-full bg-[#00A884] flex items-center justify-center text-white shadow-sm">
            <FaWhatsapp className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold tracking-tight text-[#111B21]">
                WhatsApp APIGateway
              </h1>
              <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-[#E7F7EF] text-[#00A884] border border-[#C3ECD7]">
                v1.8.0
              </span>
            </div>
            <p className="text-xs text-[#667781] flex items-center gap-1.5 mt-0.5">
              <span className="inline-block w-2 h-2 rounded-full bg-[#00A884]"></span>
              <span>Self-Hosted • Anti-Ban Pacing Active</span>
            </p>
          </div>
        </div>

        {/* Quick Tools & Controls */}
        <div className="flex items-center flex-wrap gap-2.5">
          {/* Security Status */}
          <div className="flex items-center space-x-1.5 bg-[#E7F7EF]/70 rounded-xl px-3 py-1.5 border border-[#C3ECD7] text-xs font-medium">
            <ShieldCheck className="w-4 h-4 text-[#00A884]" />
            <span className="text-[#54656F]">Auth:</span>
            <span className="font-semibold text-[#008069]">Active</span>
          </div>

          {/* Swagger Docs */}
          <a
            href={docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-white hover:bg-[#F5F6F6] text-xs font-medium border border-[#D1D7DB] text-[#111B21] transition shadow-xs"
          >
            <BookOpen className="w-3.5 h-3.5 text-[#54656F]" />
            <span>API Docs</span>
            <ExternalLink className="w-3 h-3 text-[#54656F]" />
          </a>

          {/* Prometheus Metrics */}
          <a
            href={metricsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-white hover:bg-[#F5F6F6] text-xs font-medium border border-[#D1D7DB] text-[#111B21] transition shadow-xs"
          >
            <Activity className="w-3.5 h-3.5 text-[#54656F]" />
            <span>Metrics</span>
          </a>
        </div>
      </div>
    </header>
  );
};
