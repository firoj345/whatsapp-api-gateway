'use client';

import React from 'react';
import {
  Webhook,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  KeyRound,
  ShieldCheck
} from 'lucide-react';

export interface WebhookLogItem {
  id?: string;
  event: string;
  status: string;
  attempts: number;
  signature: string;
  lastError?: string | null;
  createdAt?: string;
}

interface WebhooksTabProps {
  logs: WebhookLogItem[];
  loading: boolean;
  onRefresh: () => void;
}

export const WebhooksTab: React.FC<WebhooksTabProps> = ({
  logs,
  loading,
  onRefresh
}) => {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[#F5F5F4] flex items-center gap-2">
            <Webhook className="w-5 h-5 text-[#D4AF37]" />
            <span>Webhook Outbox & Delivery Auditing</span>
          </h2>
          <p className="text-xs text-[#A3A3A3] mt-0.5">
            Reliable event delivery with exponential backoff (up to 8 retries) & HMAC SHA-256 signatures
          </p>
        </div>

        <button
          onClick={onRefresh}
          disabled={loading}
          className="p-2 bg-[#141414] hover:bg-[#1A1A1A] text-[#A3A3A3] hover:text-[#F5F5F4] rounded-xl border border-[#262626] hover:border-[#D4AF37]/50 transition disabled:opacity-50 self-start sm:self-auto"
          title="Refresh Logs"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-[#D4AF37]' : ''}`} />
        </button>
      </div>

      {/* Logs container */}
      <div className="glass-panel rounded-2xl p-5 border border-[#262626] space-y-3">
        {logs.length === 0 ? (
          <div className="text-center py-12 text-[#A3A3A3] text-xs space-y-2">
            <Webhook className="w-8 h-8 text-[#523E11] mx-auto" />
            <p>No webhook events dispatched to the outbox yet.</p>
            <p className="text-[11px] text-[#737373]">
              When messages arrive or session status changes, events will appear here with verification hashes.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-1">
            {logs.map((l, idx) => {
              const isSuccess = l.status === 'success';
              return (
                <div
                  key={l.id || idx}
                  className="p-3.5 bg-[#0A0A0A] rounded-xl border border-[#262626] space-y-2"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono font-bold text-[#D4AF37] flex items-center gap-1.5">
                      <Webhook className="w-3.5 h-3.5 text-[#D4AF37]" />
                      <span>{l.event}</span>
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold font-mono ${
                        isSuccess
                          ? 'bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30'
                          : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                      }`}
                    >
                      {isSuccess ? (
                        <CheckCircle2 className="w-2.5 h-2.5" />
                      ) : (
                        <Clock className="w-2.5 h-2.5" />
                      )}
                      <span>
                        {l.status.toUpperCase()} ({l.attempts} attempt{l.attempts !== 1 ? 's' : ''})
                      </span>
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-[11px] font-mono text-[#A3A3A3] truncate">
                    <KeyRound className="w-3 h-3 text-[#A3A3A3] shrink-0" />
                    <span className="text-[#A3A3A3]">HMAC-SHA256:</span>
                    <span className="text-[#F5F5F4] truncate">{l.signature}</span>
                  </div>

                  {l.lastError && (
                    <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[11px] flex items-start gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                      <span>Error: {l.lastError}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
