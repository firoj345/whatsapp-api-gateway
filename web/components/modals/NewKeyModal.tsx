'use client';

import React, { useState } from 'react';
import { Modal } from '../Modal';
import { Key, Shield, Gauge, Loader2 } from 'lucide-react';

interface NewKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string, scopes: string[], rateLimitRpm: number) => Promise<void>;
}

export const NewKeyModal: React.FC<NewKeyModalProps> = ({
  isOpen,
  onClose,
  onSubmit
}) => {
  const [name, setName] = useState('External Bot Service');
  const [scopes, setScopes] = useState<string[]>([
    'messages:send',
    'messages:read',
    'sessions:manage'
  ]);
  const [rateLimit, setRateLimit] = useState(60);
  const [loading, setLoading] = useState(false);

  const availableScopes = [
    { id: 'messages:send', label: 'messages:send (Send text, media, voice)' },
    { id: 'messages:read', label: 'messages:read (Read messages & chat history)' },
    { id: 'sessions:manage', label: 'sessions:manage (Create, connect & logout sessions)' },
    { id: '*', label: '* (Full Admin Access: Manage Keys & Gateway)' }
  ];

  const toggleScope = (scopeId: string) => {
    setScopes((prev) =>
      prev.includes(scopeId) ? prev.filter((s) => s !== scopeId) : [...prev, scopeId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      await onSubmit(name.trim(), scopes, rateLimit);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Generate Scoped API Key"
      subtitle="Creates a cryptographically hashed Bearer token"
      icon={<Key className="w-5 h-5 text-[#008069]" />}
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-[#111B21] mb-1.5">
            Key Name / Client Purpose
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Production CRM Webhook"
            className="w-full bg-white border border-[#D1D7DB] rounded-xl px-3.5 py-2.5 text-xs text-[#111B21] focus:outline-none focus:border-[#00A884] focus:ring-1 focus:ring-[#00A884] transition"
          />
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[#111B21] mb-2">
            <Shield className="w-3.5 h-3.5 text-[#008069]" />
            <span>ACL Scopes & Permissions</span>
          </label>
          <div className="space-y-2 bg-[#F0F2F5] p-3 rounded-xl border border-[#E9EDEF]">
            {availableScopes.map((scope) => (
              <label
                key={scope.id}
                className="flex items-center space-x-2.5 text-xs text-[#111B21] cursor-pointer select-none"
              >
                <input
                  type="checkbox"
                  checked={scopes.includes(scope.id)}
                  onChange={() => toggleScope(scope.id)}
                  className="rounded border-[#D1D7DB] bg-white accent-[#008069] text-[#008069] focus:ring-[#008069] w-4 h-4"
                />
                <span className="font-mono text-[11px] text-[#54656F]">{scope.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="flex items-center justify-between text-xs font-semibold text-[#111B21] mb-1.5">
            <span className="flex items-center gap-1.5">
              <Gauge className="w-3.5 h-3.5 text-[#008069]" />
              <span>Rate Limit (Requests / minute)</span>
            </span>
            <span className="font-mono text-[#008069] font-bold">{rateLimit} rpm</span>
          </label>
          <input
            type="range"
            min={10}
            max={300}
            step={10}
            value={rateLimit}
            onChange={(e) => setRateLimit(Number(e.target.value))}
            className="w-full accent-[#008069] bg-[#E9EDEF] cursor-pointer"
          />
        </div>

        <div className="flex gap-2.5 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-2.5 bg-white hover:bg-[#F5F6F6] text-[#54656F] hover:text-[#111B21] rounded-xl text-xs font-medium border border-[#D1D7DB] transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="flex-1 py-2.5 bg-[#008069] hover:bg-[#00705B] text-white font-medium rounded-xl text-xs shadow-sm transition disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>Generating...</span>
              </>
            ) : (
              <span>Generate Key</span>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
