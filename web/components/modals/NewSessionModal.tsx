'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '../Modal';
import { PlusCircle, Hash, Tag, Loader2 } from 'lucide-react';

interface NewSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (id: string, name: string) => Promise<void>;
}

export const NewSessionModal: React.FC<NewSessionModalProps> = ({
  isOpen,
  onClose,
  onSubmit
}) => {
  const [sessionId, setSessionId] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSessionId(`session_${Date.now()}`);
      setSessionName('Official Business Line');
      setLoading(false);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId.trim()) return;
    setLoading(true);
    try {
      await onSubmit(sessionId.trim(), sessionName.trim() || sessionId.trim());
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create WhatsApp Session"
      subtitle="Spin up a multi-device WhatsApp instance"
      icon={<PlusCircle className="w-5 h-5 text-[#008069]" />}
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[#111B21] mb-1.5">
            <Hash className="w-3.5 h-3.5 text-[#008069]" />
            <span>Session ID (Unique identifier)</span>
          </label>
          <input
            type="text"
            required
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            placeholder="e.g. sales-line-1"
            className="w-full bg-white border border-[#D1D7DB] rounded-xl px-3.5 py-2.5 text-xs font-mono text-[#111B21] focus:outline-none focus:border-[#00A884] focus:ring-1 focus:ring-[#00A884] transition"
          />
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[#111B21] mb-1.5">
            <Tag className="w-3.5 h-3.5 text-[#008069]" />
            <span>Display Name</span>
          </label>
          <input
            type="text"
            required
            value={sessionName}
            onChange={(e) => setSessionName(e.target.value)}
            placeholder="e.g. Customer Support Line"
            className="w-full bg-white border border-[#D1D7DB] rounded-xl px-3.5 py-2.5 text-xs text-[#111B21] focus:outline-none focus:border-[#00A884] focus:ring-1 focus:ring-[#00A884] transition"
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
            disabled={loading || !sessionId.trim()}
            className="flex-1 py-2.5 bg-[#008069] hover:bg-[#00705B] text-white font-medium rounded-xl text-xs shadow-sm transition disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>Creating...</span>
              </>
            ) : (
              <span>Create Session</span>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
