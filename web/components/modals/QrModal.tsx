'use client';

import React from 'react';
import { Modal } from '../Modal';
import { QrCode, Smartphone, Loader2 } from 'lucide-react';

interface QrModalProps {
  isOpen: boolean;
  onClose: () => void;
  qrDataUrl: string | null;
  status: string;
}

export const QrModal: React.FC<QrModalProps> = ({
  isOpen,
  onClose,
  qrDataUrl,
  status
}) => {
  const isConnected = status === 'CONNECTED';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Link WhatsApp Device"
      subtitle="Scan QR with WhatsApp on your physical phone"
      icon={<QrCode className="w-5 h-5 text-[#008069]" />}
      maxWidth="max-w-sm"
    >
      <div className="space-y-4 text-center">
        {/* Step Guide */}
        <div className="flex items-center justify-center space-x-2 text-xs text-[#54656F] bg-[#F0F2F5] py-2 px-3 rounded-xl border border-[#E9EDEF]">
          <Smartphone className="w-4 h-4 text-[#008069] shrink-0" />
          <span>WhatsApp → Linked Devices → Link a Device</span>
        </div>

        {/* QR Frame */}
        <div className="bg-white p-4 rounded-2xl inline-block shadow-md border border-[#E9EDEF] ring-4 ring-[#00A884]/15">
          {qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrDataUrl}
              alt="WhatsApp Pairing QR Code"
              className="w-56 h-56 mx-auto rounded-lg"
            />
          ) : (
            <div className="w-56 h-56 flex flex-col items-center justify-center space-y-2 text-[#667781]">
              <Loader2 className="w-8 h-8 animate-spin text-[#008069]" />
              <span className="text-xs font-mono">Generating pairing QR...</span>
            </div>
          )}
        </div>

        {/* Status Line */}
        <div className="flex items-center justify-center gap-2 text-xs font-mono">
          {isConnected ? (
            <span className="text-[#008069] font-semibold animate-pulse">
              Device paired successfully!
            </span>
          ) : (
            <span className="text-amber-600 flex items-center gap-1.5 font-medium">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>
              Waiting for scan... (Auto-polling)
            </span>
          )}
        </div>

        {/* Actions */}
        <button
          onClick={onClose}
          className="w-full py-2.5 bg-white hover:bg-[#F5F6F6] text-[#111B21] rounded-xl text-xs font-semibold border border-[#D1D7DB] transition shadow-xs"
        >
          Close Window
        </button>
      </div>
    </Modal>
  );
};
