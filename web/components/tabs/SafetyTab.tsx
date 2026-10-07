'use client';

import React from 'react';
import {
  ShieldAlert,
  Keyboard,
  Timer,
  ZapOff,
  TrendingUp,
  CopyCheck,
  CheckCheck,
  CheckCircle2
} from 'lucide-react';

export const SafetyTab: React.FC = () => {
  const guardrails = [
    {
      title: 'Human Typing Simulation',
      desc: 'Simulates active "composing" status with 40-60ms/char delay ±20% jitter prior to sending every outbound text.',
      status: 'ENABLED',
      icon: Keyboard,
      color: 'text-[#008069]'
    },
    {
      title: 'Queue Rate Pacing',
      desc: 'Enforces a 2s-5s randomized delay between outgoing messages in BullMQ to avoid rapid-burst spam flagging.',
      status: 'ACTIVE',
      icon: Timer,
      color: 'text-[#008069]'
    },
    {
      title: 'Automated Circuit Breaker',
      desc: 'Auto-pauses the transmission queue for 60s if 5 consecutive delivery failures or socket disconnects occur.',
      status: 'ARMED',
      icon: ZapOff,
      color: 'text-amber-600'
    },
    {
      title: 'Warm-Up Mode Ramp',
      desc: 'Gradually scales maximum daily message caps for fresh numbers (Day 1: 50, Day 2: 100, Day 3: 250).',
      status: 'ACTIVE',
      icon: TrendingUp,
      color: 'text-[#008069]'
    },
    {
      title: 'Loop & Duplicate Guard',
      desc: 'Blocks duplicate content blasts from echoing in runaway automated loops, with configurable consecutive reply caps.',
      status: 'ACTIVE',
      icon: CopyCheck,
      color: 'text-[#008069]'
    },
    {
      title: 'Humanized Read Receipt Delay',
      desc: 'Delays blue ticks on incoming messages by 500ms-1500ms to mimic human visual processing time.',
      status: 'ENABLED',
      icon: CheckCheck,
      color: 'text-[#008069]'
    }
  ];

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-6 space-y-6 border border-[#E9EDEF] shadow-sm">
        <div>
          <h2 className="text-lg font-bold text-[#111B21] flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-[#008069]" />
            <span>Anti-Ban Guardrails & Queue Pacing</span>
          </h2>
          <p className="text-xs text-[#667781] mt-0.5">
            Active carrier defenses protecting numbers from automated WhatsApp suspensions and spam detection
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {guardrails.map((g, idx) => {
            const Icon = g.icon;
            return (
              <div
                key={idx}
                className="bg-white rounded-2xl p-5 space-y-3 border border-[#E9EDEF] shadow-sm hover:border-[#00A884] transition flex flex-col justify-between"
              >
                <div className="space-y-2.5">
                  <div className="w-10 h-10 rounded-xl bg-[#E7F7EF] border border-[#C3ECD7] flex items-center justify-center text-[#008069]">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h4 className="text-sm font-bold text-[#111B21]">{g.title}</h4>
                  <p className="text-xs text-[#667781] leading-relaxed">{g.desc}</p>
                </div>

                <div className="pt-3 border-t border-[#E9EDEF] flex items-center justify-between text-xs font-mono">
                  <span className="text-[#667781] text-[11px]">Engine Status:</span>
                  <span className="inline-flex items-center gap-1 font-bold text-[#008069]">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#00A884]" />
                    <span>{g.status}</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
