'use client';

import React from 'react';
import {
  Smartphone,
  RefreshCw,
  Plus,
  QrCode,
  LogOut,
  Clock,
  Layers
} from 'lucide-react';

export interface SessionData {
  id: string;
  name: string;
  phoneNumber?: string | null;
  status: string;
  reconnectAttempts: number;
  lastEventAt?: string;
  createdAt?: string;
}

interface SessionsTabProps {
  sessions: SessionData[];
  loading: boolean;
  onRefresh: () => void;
  onOpenNewSession: () => void;
  onViewQr: (sessionId: string) => void;
  onLogoutSession: (session: SessionData) => void;
}

export const SessionsTab: React.FC<SessionsTabProps> = ({
  sessions,
  loading,
  onRefresh,
  onOpenNewSession,
  onViewQr,
  onLogoutSession
}) => {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'CONNECTED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-full font-mono font-medium bg-[#E7F7EF] text-[#008069] border border-[#C3ECD7]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00A884] animate-pulse"></span>
            CONNECTED
          </span>
        );
      case 'QR_PENDING':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-full font-mono font-medium bg-amber-50 text-amber-700 border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping"></span>
            QR_PENDING
          </span>
        );
      case 'RECONNECTING':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-full font-mono font-medium bg-sky-50 text-sky-700 border border-sky-200">
            <RefreshCw className="w-3 h-3 animate-spin text-sky-600" />
            RECONNECTING
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-full font-mono font-medium bg-[#F0F2F5] text-[#54656F] border border-[#E9EDEF]">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[#111B21] flex items-center gap-2">
            <Layers className="w-5 h-5 text-[#008069]" />
            <span>Active WhatsApp Sessions</span>
          </h2>
          <p className="text-xs text-[#667781] mt-0.5">
            Multi-number instances with persistent PostgreSQL state and automatic reconnection
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-2 bg-white hover:bg-[#F5F6F6] text-[#54656F] hover:text-[#111B21] rounded-xl border border-[#D1D7DB] transition disabled:opacity-50 shadow-xs"
            title="Refresh Sessions"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-[#008069]' : ''}`} />
          </button>
          <button
            onClick={onOpenNewSession}
            className="inline-flex items-center space-x-1.5 px-4 py-2 bg-[#008069] hover:bg-[#00705B] text-white font-medium rounded-xl text-xs shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Session</span>
          </button>
        </div>
      </div>

      {/* Grid of Sessions */}
      {sessions.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center space-y-4 border border-[#E9EDEF] shadow-sm">
          <div className="w-14 h-14 rounded-2xl bg-[#E7F7EF] flex items-center justify-center mx-auto text-[#008069]">
            <Smartphone className="w-7 h-7 text-[#008069]" />
          </div>
          <div className="max-w-sm mx-auto">
            <h3 className="text-sm font-bold text-[#111B21]">No WhatsApp Sessions</h3>
            <p className="text-xs text-[#667781] mt-1">
              Connect your first WhatsApp phone number by creating a session and scanning the pairing QR code.
            </p>
          </div>
          <button
            onClick={onOpenNewSession}
            className="inline-flex items-center space-x-1.5 px-4 py-2 bg-[#008069] hover:bg-[#00705B] text-white font-medium rounded-xl text-xs transition shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Create Session Now</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {sessions.map((s) => (
            <div
              key={s.id}
              className="bg-white rounded-2xl p-5 space-y-4 border border-[#E9EDEF] shadow-sm hover:border-[#00A884] transition group"
            >
              {/* Card top */}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="font-bold text-sm text-[#111B21] group-hover:text-[#008069] transition-colors">
                    {s.name}
                  </h4>
                  <div className="text-[11px] font-mono text-[#667781] mt-0.5">{s.id}</div>
                </div>
                {getStatusBadge(s.status)}
              </div>

              {/* Card details */}
              <div className="space-y-2 text-xs bg-[#F0F2F5] p-3 rounded-xl border border-[#E9EDEF]">
                <div className="flex items-center justify-between text-[#54656F]">
                  <span className="flex items-center gap-1.5">
                    <Smartphone className="w-3.5 h-3.5 text-[#008069]" />
                    <span>Phone:</span>
                  </span>
                  <span className="font-mono text-[#111B21] font-semibold">
                    {s.phoneNumber ? `+${s.phoneNumber}` : 'Not Linked'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-[#54656F]">
                  <span className="flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5 text-[#00A884]" />
                    <span>Reconnects:</span>
                  </span>
                  <span className="font-mono text-[#111B21]">{s.reconnectAttempts}</span>
                </div>

                {s.lastEventAt && (
                  <div className="flex items-center justify-between text-[#54656F] text-[10px]">
                    <span className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-[#667781]" />
                      <span>Last Event:</span>
                    </span>
                    <span className="font-mono text-[#667781]">
                      {new Date(s.lastEventAt).toLocaleTimeString()}
                    </span>
                  </div>
                )}
              </div>

              {/* Card actions */}
              <div className="flex items-center gap-2 pt-1 border-t border-[#E9EDEF]">
                {s.status === 'QR_PENDING' && (
                  <button
                    onClick={() => onViewQr(s.id)}
                    className="flex-1 py-2 bg-[#008069] hover:bg-[#00705B] text-white font-medium text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-sm transition"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>View QR</span>
                  </button>
                )}
                {s.status === 'CONNECTED' && (
                  <button
                    onClick={() => onViewQr(s.id)}
                    className="flex-1 py-2 bg-white hover:bg-[#F5F6F6] text-[#111B21] font-medium text-xs rounded-xl flex items-center justify-center gap-1.5 border border-[#D1D7DB] transition shadow-xs"
                  >
                    <QrCode className="w-3.5 h-3.5 text-[#008069]" />
                    <span>Pairing Info</span>
                  </button>
                )}
                <button
                  onClick={() => onLogoutSession(s)}
                  className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-xl text-xs font-medium flex items-center gap-1.5 transition"
                  title="Logout and delete session"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Logout</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
