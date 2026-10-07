'use client';

import React, { useState } from 'react';
import { Modal } from '../Modal';
import { Key, Copy, Check, AlertTriangle } from 'lucide-react';

interface ApiKeySuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey: string;
}

export const ApiKeySuccessModal: React.FC<ApiKeySuccessModalProps> = ({
  isOpen,
  onClose,
  apiKey
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="API Key Generated Successfully"
      subtitle="Save this secret token in a secure location"
      icon={<Key className="w-5 h-5 text-[#008069]" />}
      maxWidth="max-w-md"
    >
      <div className="space-y-4">
        {/* Warning banner */}
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
          <span>
            Copy this secret key now! For security, it is stored as a SHA-256 hash in the database and <strong>cannot be viewed again</strong>.
          </span>
        </div>

        {/* Key Display & Copy */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-mono text-[#667781]">Bearer Token</label>
          <div className="flex items-center gap-2 bg-[#F0F2F5] p-2.5 rounded-xl border border-[#E9EDEF]">
            <input
              type="text"
              readOnly
              value={apiKey}
              className="bg-transparent text-xs font-mono text-[#008069] font-bold flex-1 outline-none select-all"
            />
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 bg-[#008069] hover:bg-[#00705B] text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition shadow-xs"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full py-2.5 bg-white hover:bg-[#F5F6F6] text-[#111B21] rounded-xl text-xs font-medium border border-[#D1D7DB] transition mt-2 shadow-xs"
        >
          Done
        </button>
      </div>
    </Modal>
  );
};
