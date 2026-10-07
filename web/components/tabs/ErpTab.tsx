'use client';

import React, { useState } from 'react';
import {
  Mic,
  Database,
  Search,
  Package,
  ShoppingCart,
  Terminal,
  Sparkles,
  Loader2,
  DollarSign
} from 'lucide-react';

export interface ProductItem {
  id: string;
  name: string;
  sku: string;
  price: string | number;
  stockQty: number;
}

export interface SaleItem {
  id: string;
  itemName: string;
  quantity: number;
  totalAmount: string | number;
  createdAt?: string;
}

interface ErpTabProps {
  products: ProductItem[];
  sales: SaleItem[];
  onRunQuery: (query: string) => Promise<{
    detectedIntent: string;
    querySql?: string;
    result: string;
  }>;
}

export const ErpTab: React.FC<ErpTabProps> = ({
  products,
  sales,
  onRunQuery
}) => {
  const [queryInput, setQueryInput] = useState('');
  const [queryResult, setQueryResult] = useState<{
    detectedIntent: string;
    querySql?: string;
    result: string;
  } | null>(null);
  const [running, setRunning] = useState(false);

  const handleRun = async (q?: string) => {
    const text = q || queryInput;
    if (!text.trim()) return;
    setRunning(true);
    try {
      const res = await onRunQuery(text.trim());
      setQueryResult(res);
    } finally {
      setRunning(false);
    }
  };

  const sampleQueries = [
    'How many MacBook units are in stock?',
    'What was today\'s total sales?',
    'Check inventory for Sony headphones',
    'List all recent sales orders'
  ];

  return (
    <div className="space-y-6">
      {/* Query Sandbox Card */}
      <div className="glass-panel rounded-2xl p-6 space-y-5 border border-[#262626]">
        <div>
          <h3 className="text-sm font-bold text-[#F5F5F4] flex items-center gap-2">
            <Mic className="w-4 h-4 text-[#D4AF37]" />
            <span>Voice-to-Database / ERP Query Sandbox</span>
          </h3>
          <p className="text-xs text-[#A3A3A3] mt-0.5">
            Test natural language ERP queries against local PostgreSQL stock and sales tables (simulating WhatsApp audio notes)
          </p>
        </div>

        {/* Input box */}
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#A3A3A3] absolute left-3.5 top-3.5" />
            <input
              type="text"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRun()}
              placeholder="Ask a question about stock, prices, or sales..."
              className="w-full bg-[#0A0A0A] border border-[#262626] rounded-xl pl-10 pr-4 py-2.5 text-xs text-[#F5F5F4] focus:outline-none focus:border-[#D4AF37] transition"
            />
          </div>
          <button
            onClick={() => handleRun()}
            disabled={running || !queryInput.trim()}
            className="px-5 py-2.5 bg-gradient-to-r from-[#DEBF6E] via-[#D4AF37] to-[#B89326] hover:brightness-110 text-[#0A0A0A] font-bold rounded-xl text-xs shadow-md shadow-[#D4AF37]/20 transition disabled:opacity-50 flex items-center justify-center gap-1.5 shrink-0"
          >
            {running ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-[#0A0A0A]" />
                <span>Querying ERP...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-[#0A0A0A]" />
                <span>Run Query</span>
              </>
            )}
          </button>
        </div>

        {/* Sample query pills */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[#A3A3A3] text-[11px]">Quick samples:</span>
          {sampleQueries.map((sample, idx) => (
            <button
              key={idx}
              onClick={() => {
                setQueryInput(sample);
                handleRun(sample);
              }}
              className="px-2.5 py-1 rounded-lg bg-[#0A0A0A] hover:bg-[#1A1A1A] text-[#A3A3A3] hover:text-[#F5F5F4] text-[11px] border border-[#262626] hover:border-[#D4AF37]/40 transition"
            >
              {sample}
            </button>
          ))}
        </div>

        {/* Query Result Card */}
        {queryResult && (
          <div className="p-4 rounded-xl bg-[#0A0A0A] border border-[#262626] space-y-3 animate-in fade-in duration-200">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono border-b border-[#262626] pb-2.5">
              <span className="flex items-center gap-1.5">
                <span className="text-[#A3A3A3]">Intent:</span>
                <span className="px-2 py-0.5 rounded bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30 font-semibold">
                  {queryResult.detectedIntent}
                </span>
              </span>
              <span className="flex items-center gap-1.5 text-[#DEBF6E]">
                <Terminal className="w-3.5 h-3.5" />
                <span>{queryResult.querySql || 'Parameterized Query'}</span>
              </span>
            </div>

            <div className="p-3.5 rounded-lg bg-[#141414] border border-[#262626] text-xs text-[#F5F5F4] whitespace-pre-wrap leading-relaxed">
              {queryResult.result}
            </div>
          </div>
        )}
      </div>

      {/* Demo Database Tables Preview */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Products Table */}
        <div className="glass-panel rounded-2xl p-5 space-y-3 border border-[#262626]">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-[#F5F5F4] flex items-center gap-2">
              <Package className="w-4 h-4 text-[#D4AF37]" />
              <span>Demo Inventory (erp_products)</span>
            </h4>
            <span className="text-[11px] font-mono text-[#A3A3A3]">{products.length} items</span>
          </div>

          <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
            {products.length === 0 ? (
              <div className="text-center py-6 text-[#A3A3A3] text-xs">
                No inventory seeded in database.
              </div>
            ) : (
              products.map((p) => (
                <div
                  key={p.id}
                  className="p-2.5 rounded-lg bg-[#0A0A0A] border border-[#262626] flex items-center justify-between text-xs"
                >
                  <div>
                    <span className="font-semibold text-[#F5F5F4]">{p.name}</span>
                    <span className="text-[10px] font-mono text-[#A3A3A3] ml-1.5">({p.sku})</span>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-[#D4AF37] font-mono">
                      {p.stockQty} in stock
                    </span>
                    <span className="text-[10px] text-[#A3A3A3] ml-2">${p.price}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Sales Table */}
        <div className="glass-panel rounded-2xl p-5 space-y-3 border border-[#262626]">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-[#F5F5F4] flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-[#DEBF6E]" />
              <span>Sales Orders (erp_sales)</span>
            </h4>
            <span className="text-[11px] font-mono text-[#A3A3A3]">{sales.length} orders</span>
          </div>

          <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
            {sales.length === 0 ? (
              <div className="text-center py-6 text-[#A3A3A3] text-xs">
                No sales records in database.
              </div>
            ) : (
              sales.map((s) => (
                <div
                  key={s.id}
                  className="p-2.5 rounded-lg bg-[#0A0A0A] border border-[#262626] flex items-center justify-between text-xs"
                >
                  <div>
                    <span className="font-semibold text-[#F5F5F4]">{s.itemName}</span>
                    <span className="text-[10px] font-mono text-[#A3A3A3] ml-1.5">x{s.quantity}</span>
                  </div>
                  <span className="font-bold text-[#DEBF6E] font-mono">${s.totalAmount}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
