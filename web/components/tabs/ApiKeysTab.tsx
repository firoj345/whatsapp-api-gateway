'use client';

import React from 'react';
import {
  Key,
  Plus,
  Trash2,
  Lock,
  CheckCircle2,
  RefreshCw
} from 'lucide-react';

export interface ApiKeyItem {
  id: string;
  name: string;
  prefix: string;
  scopes?: string[];
  rateLimitRpm: number;
  createdAt?: string;
  revokedAt?: string | null;
}

interface ApiKeysTabProps {
  apiKeys: ApiKeyItem[];
  loading: boolean;
  onRefresh: () => void;
  onOpenNewKeyModal: () => void;
  onRevokeKey: (key: ApiKeyItem) => void;
}

export const ApiKeysTab: React.FC<ApiKeysTabProps> = ({
  apiKeys,
  loading,
  onRefresh,
  onOpenNewKeyModal,
  onRevokeKey
}) => {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[#111B21] flex items-center gap-2">
            <Lock className="w-5 h-5 text-[#008069]" />
            <span>API Keys & Chat-Level Permissions (ACL)</span>
          </h2>
          <p className="text-xs text-[#667781] mt-0.5">
            Cryptographically hashed Bearer tokens with fine-grained endpoint scopes and rate limits
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-2 bg-white hover:bg-[#F5F6F6] text-[#54656F] hover:text-[#111B21] rounded-xl border border-[#D1D7DB] transition disabled:opacity-50 shadow-xs"
            title="Refresh Keys"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-[#008069]' : ''}`} />
          </button>
          <button
            onClick={onOpenNewKeyModal}
            className="inline-flex items-center space-x-1.5 px-4 py-2 bg-[#008069] hover:bg-[#00705B] text-white font-medium rounded-xl text-xs shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            <span>Generate New API Key</span>
          </button>
        </div>
      </div>

      {/* Keys Table Card */}
      <div className="bg-white rounded-2xl p-5 overflow-x-auto border border-[#E9EDEF] shadow-sm">
        <table className="w-full text-left text-xs text-[#111B21]">
          <thead className="text-[11px] font-mono text-[#667781] uppercase tracking-wider border-b border-[#E9EDEF] pb-2">
            <tr>
              <th className="py-3 px-3.5">Name / Purpose</th>
              <th className="py-3 px-3.5">Prefix</th>
              <th className="py-3 px-3.5">Granted Scopes</th>
              <th className="py-3 px-3.5">Rate Limit</th>
              <th className="py-3 px-3.5">Status</th>
              <th className="py-3 px-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E9EDEF]">
            {apiKeys.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-[#667781] text-xs">
                  No custom API keys generated yet. Click &quot;Generate New API Key&quot; to create one.
                </td>
              </tr>
            ) : (
              apiKeys.map((k) => (
                <tr key={k.id} className="hover:bg-[#F5F6F6] transition-colors">
                  <td className="py-3 px-3.5 font-bold text-[#111B21] flex items-center gap-2">
                    <Key className="w-3.5 h-3.5 text-[#008069] shrink-0" />
                    <span>{k.name}</span>
                  </td>
                  <td className="py-3 px-3.5 font-mono text-[#008069] font-semibold">
                    {k.prefix}...
                  </td>
                  <td className="py-3 px-3.5">
                    <div className="flex flex-wrap gap-1">
                      {(k.scopes || []).map((scope, sIdx) => (
                        <span
                          key={sIdx}
                          className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#F0F2F5] text-[#54656F] border border-[#E9EDEF]"
                        >
                          {scope}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 px-3.5 font-mono text-[#667781]">
                    {k.rateLimitRpm} rpm
                  </td>
                  <td className="py-3 px-3.5">
                    {k.revokedAt ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-rose-50 text-rose-600 border border-rose-200">
                        REVOKED
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#E7F7EF] text-[#008069] border border-[#C3ECD7]">
                        <CheckCircle2 className="w-2.5 h-2.5 text-[#00A884]" />
                        ACTIVE
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-3.5 text-right">
                    <button
                      onClick={() => onRevokeKey(k)}
                      disabled={!!k.revokedAt}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition inline-flex items-center gap-1 ${
                        k.revokedAt
                          ? 'text-[#8696A0] cursor-not-allowed opacity-50'
                          : 'text-rose-600 hover:text-rose-700 hover:bg-rose-50'
                      }`}
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>{k.revokedAt ? 'Revoked' : 'Revoke'}</span>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
