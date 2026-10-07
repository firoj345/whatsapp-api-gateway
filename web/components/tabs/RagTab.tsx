'use client';

import React, { useState, useRef } from 'react';
import {
  Brain,
  Layers,
  Search,
  Sparkles,
  FileText,
  Trash2,
  Eye,
  Plus,
  Loader2,
  CheckCircle2,
  Database,
  Tag,
  ArrowRight,
  Info,
  Clock,
  Hash,
  UploadCloud,
  Image as ImageIcon,
  FileCode,
  File,
  X,
  ScanText,
  Check,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Lock,
  Globe,
  Building2,
  Ban
} from 'lucide-react';

export const ACCESS_LEVEL_CONFIG: Record<
  number,
  {
    label: string;
    name: string;
    color: string;
    bg: string;
    border: string;
    desc: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  1: {
    label: 'Level 1: Public',
    name: 'public',
    color: 'text-emerald-700',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    desc: 'Public FAQs, product catalog, return rules. Safe for all WhatsApp users.',
    icon: Globe
  },
  2: {
    label: 'Level 2: Internal',
    name: 'internal',
    color: 'text-sky-700',
    bg: 'bg-sky-50',
    border: 'border-sky-200',
    desc: 'Internal SOPs, operational procedures, non-sensitive team guidelines.',
    icon: Building2
  },
  3: {
    label: 'Level 3: Confidential',
    name: 'confidential',
    color: 'text-amber-800',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    desc: 'Customer PII, employee HR & salaries, financial metrics, roadmap, contracts.',
    icon: Lock
  },
  4: {
    label: 'Level 4: Restricted / Secret',
    name: 'restricted',
    color: 'text-rose-700',
    bg: 'bg-rose-50',
    border: 'border-rose-200',
    desc: 'API keys, JWT secrets, passwords, AWS/cloud keys, SSH keys, DB dumps, source code.',
    icon: Ban
  }
};

export interface DocumentItem {
  id: string;
  title: string;
  source: string;
  rawText: string;
  chunkCount: number;
  accessLevel?: number;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface ChunkItem {
  id: string;
  chunkIndex: number;
  topic: string;
  content: string;
  tokenCount: number;
  accessLevel?: number;
  hasEmbedding?: boolean;
  embeddingLength?: number;
  metadata?: {
    accessLevelName?: string;
    sensitivityFlags?: string[];
    detectedReasons?: string[];
    [key: string]: any;
  };
}

export interface SearchMatch {
  documentTitle: string;
  topic: string;
  content: string;
  similarity: number;
  tokenCount: number;
  accessLevel?: number;
  metadata?: {
    sensitivityFlags?: string[];
    [key: string]: any;
  };
}

interface RagTabProps {
  documents: DocumentItem[];
  loadingDocs: boolean;
  onRefreshDocs: () => void;
  onIngestDocument: (payload: {
    title?: string;
    source?: string;
    text?: string;
    accessLevel?: number;
    fileBase64?: string;
    filename?: string;
    mimeType?: string;
    maxTokensPerChunk?: number;
  }) => Promise<any>;
  onDeleteDocument: (id: string) => Promise<void>;
  onFetchChunks: (documentId: string) => Promise<ChunkItem[]>;
  onSemanticSearch: (query: string, userAccessLevel?: number) => Promise<SearchMatch[]>;
  onExtractFile?: (payload: { fileBase64: string; filename: string; mimeType?: string }) => Promise<any>;
}

export const RagTab: React.FC<RagTabProps> = ({
  documents,
  loadingDocs,
  onRefreshDocs,
  onIngestDocument,
  onDeleteDocument,
  onFetchChunks,
  onSemanticSearch,
  onExtractFile
}) => {
  // Ingest form state
  const [docTitle, setDocTitle] = useState('');
  const [docSource, setDocSource] = useState('policy');
  const [docText, setDocText] = useState('');
  const [docAccessLevel, setDocAccessLevel] = useState<number>(1);
  const [maxTokens, setMaxTokens] = useState<number>(512);
  const [ingesting, setIngesting] = useState(false);
  const [ingestStatus, setIngestStatus] = useState<string | null>(null);

  // File Upload State
  const [ingestMode, setIngestMode] = useState<'upload' | 'text'>('upload');
  const [selectedFile, setSelectedFile] = useState<{
    file: File;
    base64: string;
    previewUrl?: string;
    isImage: boolean;
    isPdf: boolean;
  } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Search tester state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchUserLevel, setSearchUserLevel] = useState<number>(1);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchMatch[] | null>(null);

  // Inspector modal state
  const [inspectModalOpen, setInspectModalOpen] = useState(false);
  const [inspectingDoc, setInspectingDoc] = useState<DocumentItem | null>(null);
  const [inspectingChunks, setInspectingChunks] = useState<ChunkItem[]>([]);
  const [loadingChunks, setLoadingChunks] = useState(false);

  // Handle file selection and read as base64
  const handleFileChange = (file: File) => {
    const isImage = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf' || file.name.endsWith('.pdf');

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      setSelectedFile({
        file,
        base64,
        previewUrl: isImage ? base64 : undefined,
        isImage,
        isPdf
      });

      // Default the title to file name without extension if title is blank
      if (!docTitle) {
        const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
        setDocTitle(cleanName.charAt(0).toUpperCase() + cleanName.slice(1));
      }

      // Default source category based on file type
      if (isPdf && docSource === 'policy') setDocSource('pdf');
      if (isImage && docSource === 'policy') setDocSource('image');
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleClearFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Perform AI extraction on the uploaded file to preview text
  const handleExtractOnly = async () => {
    if (!selectedFile) return;
    setExtracting(true);
    setIngestStatus('Running AI Multimodal OCR & Document Extraction...');
    try {
      if (onExtractFile) {
        const data = await onExtractFile({
          fileBase64: selectedFile.base64,
          filename: selectedFile.file.name,
          mimeType: selectedFile.file.type
        });
        if (data.text) {
          setDocText(data.text);
          if (!docTitle) setDocTitle(data.detectedTitle);
          setIngestStatus('Text successfully extracted! Review or edit below.');
        }
      }
    } catch (err: any) {
      setIngestStatus(`Extraction warning: ${err.message || 'Failed reading file'}`);
    } finally {
      setExtracting(false);
    }
  };

  // Ingestion handler: accepts text or uploaded file directly (title is optional)
  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docText.trim() && !selectedFile) return;

    setIngesting(true);
    setIngestStatus('Analyzing thematic topic boundaries with Semantic Chunker...');

    try {
      setTimeout(() => {
        setIngestStatus('Generating vector embeddings via Gemini model...');
      }, 1500);

      // Auto-generate title if user left it blank
      const fallbackTitle =
        selectedFile?.file.name.replace(/\.[^/.]+$/, '') ||
        (docText.trim().split(/[\r\n]+/)[0]?.replace(/^[#*\-–—\s]+/, '').trim().slice(0, 50)) ||
        'Knowledge Document';
      const resolvedTitle = docTitle.trim() || fallbackTitle;

      const res = await onIngestDocument({
        title: resolvedTitle,
        source: docSource,
        text: docText.trim() || undefined,
        accessLevel: docAccessLevel,
        fileBase64: selectedFile ? selectedFile.base64 : undefined,
        filename: selectedFile?.file.name,
        mimeType: selectedFile?.file.type,
        maxTokensPerChunk: maxTokens
      });

      setIngestStatus(`Success! Ingested ${res.chunkCount || 'all'} semantic chunks into Vector DB.`);
      setDocTitle('');
      setDocText('');
      handleClearFile();
      // Auto inspect freshly created chunks
      if (res?.document && res?.chunks) {
        setInspectingDoc(res.document);
        const chunkList = Array.isArray(res.chunks)
          ? res.chunks
          : Array.isArray(res.chunks?.chunks)
          ? res.chunks.chunks
          : [];
        setInspectingChunks(chunkList);
        setInspectModalOpen(true);
      }

      setTimeout(() => setIngestStatus(null), 4000);
    } catch (err: any) {
      setIngestStatus(null);
    } finally {
      setIngesting(false);
    }
  };

  // Inspect chunks for a document
  const handleOpenChunks = async (doc: DocumentItem) => {
    setInspectingDoc(doc);
    setLoadingChunks(true);
    setInspectModalOpen(true);
    try {
      const data: any = await onFetchChunks(doc.id);
      const chunkList = Array.isArray(data)
        ? data
        : Array.isArray(data?.chunks)
        ? data.chunks
        : [];
      setInspectingChunks(chunkList);
    } catch (err) {
      setInspectingChunks([]);
    } finally {
      setLoadingChunks(false);
    }
  };

  // Search handler
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setSearching(true);
    try {
      const matches = await onSemanticSearch(searchQuery.trim(), searchUserLevel);
      setSearchResults(matches);
    } catch (err) {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const loadSampleData = () => {
    setDocTitle('E-Commerce Store Policies & Customer Guide');
    setDocSource('policy');
    setDocText(`SECTION 1: SHIPPING AND DELIVERY
We ship all orders across the country within 24 to 48 business hours. Standard ground delivery takes 3 to 5 business days, while express delivery guarantees arrival within 2 business days. Free shipping is automatically applied on all orders above $50. Once your package departs our facility, you will receive an automatic tracking code on WhatsApp and via email.

SECTION 2: RETURN AND REFUND POLICY
Customers have a 30-day return window starting from the delivery date. Items must be in their original packaging, unworn, and with tags attached. Once our quality inspection team approves the returned item, a full refund is processed back to the original payment method within 3 to 5 business days. Return shipping is free if the product arrived damaged or defective.

SECTION 3: WARRANTY AND REPLACEMENTS
All electronics and appliances purchased through our catalog include a complimentary 1-year manufacturer warranty. The warranty protects against manufacturing defects, electronic failures, and internal component faults. Accidental physical drops, liquid immersion, or unauthorized third-party repairs void the warranty coverage.

SECTION 4: PAYMENT OPTIONS AND SECURITY
We accept Visa, Mastercard, American Express, Apple Pay, Google Pay, and Cash on Delivery in select metro regions. All card transactions are encrypted using bank-grade 256-bit SSL protocols. We do not store full credit card numbers on our servers.`);
  };

  const SelectedLevelIcon = ACCESS_LEVEL_CONFIG[docAccessLevel]?.icon || Globe;

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white rounded-2xl border border-[#E9EDEF] p-6 shadow-sm relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#E7F7EF] text-[#008069] border border-[#C3ECD7] shrink-0">
              <Brain className="h-6 w-6" />
            </span>
            <div className="space-y-0.5">
              <h2 className="text-base sm:text-lg font-bold text-[#111B21] tracking-tight">
                RAG Pipeline: Multimodal Ingestion & Vector Engine
              </h2>
              <p className="text-xs text-[#667781] max-w-3xl leading-relaxed">
                Feed documents (PDF, Word, TXT, CSV), images (OCR Vision), or raw text. Semantic chunking segments content by topic boundaries and generates vector embeddings for high-accuracy WhatsApp AI retrieval.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={loadSampleData}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-[#008069] bg-white hover:bg-[#F5F6F6] border border-[#D1D7DB] rounded-xl transition shadow-xs shrink-0"
          >
            <Sparkles className="h-3.5 w-3.5 text-[#00A884]" />
            <span>Load Sample Policy</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Data Feeding Station & Semantic Search Tester */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Data Feeding Station (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white rounded-2xl border border-[#E9EDEF] p-6 space-y-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-[#E9EDEF] pb-4">
              <div className="flex items-center gap-2">
                <Plus className="h-4 w-4 text-[#008069]" />
                <h3 className="text-sm font-bold text-[#111B21]">Multimodal Knowledge Ingestion</h3>
              </div>

              {/* Ingestion Mode Toggle */}
              <div className="flex rounded-xl bg-[#F0F2F5] p-1 border border-[#E9EDEF]">
                <button
                  type="button"
                  onClick={() => setIngestMode('upload')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition ${ingestMode === 'upload'
                    ? 'bg-white text-[#008069] font-semibold shadow-xs'
                    : 'text-[#54656F] hover:text-[#111B21] font-medium'
                    }`}
                >
                  <UploadCloud className="h-3.5 w-3.5" />
                  <span>Doc / Image Upload</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIngestMode('text')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition ${ingestMode === 'text'
                    ? 'bg-white text-[#008069] font-semibold shadow-xs'
                    : 'text-[#54656F] hover:text-[#111B21] font-medium'
                    }`}
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span>Direct Text</span>
                </button>
              </div>
            </div>

            <form onSubmit={handleIngest} className="space-y-4">
              {/* Title, Source Category & Security Access Level Row */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5">
                <div className="sm:col-span-6 space-y-1.5">
                  <label className="text-xs font-semibold text-[#111B21]">Document Title (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Return Policy (auto-generated if empty)"
                    value={docTitle}
                    onChange={(e) => setDocTitle(e.target.value)}
                    className="w-full rounded-xl border border-[#D1D7DB] bg-white px-3.5 py-2.5 text-xs text-[#111B21] placeholder-[#8696A0] focus:border-[#00A884] focus:outline-none focus:ring-1 focus:ring-[#00A884] transition"
                  />
                </div>

                <div className="sm:col-span-3 space-y-1.5">
                  <label className="text-xs font-semibold text-[#111B21]">Source Type</label>
                  <select
                    value={docSource}
                    onChange={(e) => setDocSource(e.target.value)}
                    className="w-full rounded-xl border border-[#D1D7DB] bg-white px-3 py-2.5 text-xs text-[#111B21] focus:border-[#00A884] focus:outline-none focus:ring-1 focus:ring-[#00A884] transition"
                  >
                    <option value="policy">Policy / Rules</option>
                    <option value="faq">FAQ</option>
                    <option value="pdf">PDF Document</option>
                    <option value="image">Image / OCR</option>
                    <option value="word">Word Document</option>
                    <option value="product">Product Details</option>
                    <option value="manual">Manual / Guide</option>
                  </select>
                </div>

                <div className="sm:col-span-3 space-y-3">
                  <label className="text-xs font-semibold text-[#111B21] flex items-center justify-between">
                    <span className="flex items-center gap-1 text-[#111B21]">
                      <Shield className="h-3.5 w-3.5 text-[#008069]" />
                      Access Level
                    </span>
                  </label>
                  <select
                    value={docAccessLevel}
                    onChange={(e) => setDocAccessLevel(Number(e.target.value))}
                    className={`w-full rounded-xl border px-3 py-2.5 text-xs font-semibold focus:outline-none transition ${ACCESS_LEVEL_CONFIG[docAccessLevel].bg} ${ACCESS_LEVEL_CONFIG[docAccessLevel].color} ${ACCESS_LEVEL_CONFIG[docAccessLevel].border}`}
                  >
                    <option value={1}>Level 1 - Public (WhatsApp)</option>
                    <option value={2}>Level 2 - Internal (SOPs)</option>
                    <option value={3}>Level 3 - Confidential (PII/HR)</option>
                    <option value={4}>Level 4 - Restricted (Secrets)</option>
                  </select>
                </div>
              </div>

              {/* Dynamic Security Level Explanation */}
              <div className={`flex items-start gap-2.5 rounded-xl border p-3 text-xs ${ACCESS_LEVEL_CONFIG[docAccessLevel].bg} ${ACCESS_LEVEL_CONFIG[docAccessLevel].border}`}>
                <div className="mt-0.5 shrink-0">
                  <SelectedLevelIcon className="h-4 w-4" />
                </div>
                <div className="flex-1 space-y-1">
                  <div className="font-semibold text-[#111B21]">
                    {ACCESS_LEVEL_CONFIG[docAccessLevel].label}:{' '}
                    <span className="font-normal text-[#54656F]">{ACCESS_LEVEL_CONFIG[docAccessLevel].desc}</span>
                  </div>
                  <p className="text-[11px] text-[#667781] flex items-center gap-1">
                    <ShieldCheck className="h-3.5 w-3.5 text-[#008069] shrink-0" />
                    <span><strong className="text-[#111B21]">Auto-Elevator Active:</strong> Any chunk containing detected API keys, passwords, or PII is automatically elevated to Confidential (L3) or Restricted (L4).</span>
                  </p>
                </div>
              </div>

              {/* Upload Dropzone (When in upload mode) */}
              {ingestMode === 'upload' && (
                <div className="space-y-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json,.png,.jpg,.jpeg,.webp"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleFileChange(e.target.files[0]);
                      }
                    }}
                  />

                  {!selectedFile ? (
                    <div
                      onDrop={handleDrop}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onClick={() => fileInputRef.current?.click()}
                      className={`cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition ${isDragOver
                        ? 'border-[#008069] bg-[#E7F7EF]/50'
                        : 'border-[#D1D7DB] bg-[#F5F6F6] hover:bg-white hover:border-[#00A884]'
                        }`}
                    >
                      <div className="flex flex-col items-center justify-center space-y-2.5">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#E7F7EF] text-[#008069] border border-[#C3ECD7]">
                          <UploadCloud className="h-5 w-5" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-[#111B21]">
                            Click to upload or drag & drop any file
                          </p>
                          <p className="text-[11px] text-[#667781]">
                            Documents: PDF, Word (.docx), TXT, Markdown, CSV, JSON
                          </p>
                          <p className="text-[11px] text-[#667781]">
                            Images: PNG, JPG, JPEG, WEBP (Multimodal OCR Vision)
                          </p>
                        </div>
                        <span className="inline-block text-[10px] font-semibold text-[#008069] bg-[#E7F7EF] px-3 py-0.5 rounded-full border border-[#C3ECD7]">
                          Supports up to 25MB
                        </span>
                      </div>
                    </div>
                  ) : (
                    /* Selected File Card */
                    <div className="rounded-xl border border-[#C3ECD7] bg-[#E7F7EF]/40 p-3.5 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {selectedFile.isImage ? (
                            selectedFile.previewUrl ? (
                              <img
                                src={selectedFile.previewUrl}
                                alt="Preview"
                                className="h-11 w-11 rounded-lg object-cover border border-[#C3ECD7] shadow-xs"
                              />
                            ) : (
                              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#E7F7EF] text-[#008069] border border-[#C3ECD7]">
                                <ImageIcon className="h-5 w-5" />
                              </div>
                            )
                          ) : selectedFile.isPdf ? (
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-50 text-rose-600 border border-rose-200">
                              <FileText className="h-5 w-5" />
                            </div>
                          ) : (
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-50 text-sky-600 border border-sky-200">
                              <File className="h-5 w-5" />
                            </div>
                          )}

                          <div className="space-y-0.5">
                            <p className="text-xs font-bold text-[#111B21] truncate max-w-[200px] sm:max-w-xs">
                              {selectedFile.file.name}
                            </p>
                            <p className="text-[10px] text-[#667781] font-mono">
                              {(selectedFile.file.size / 1024).toFixed(1)} KB • {selectedFile.file.type || 'Document'}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {onExtractFile && (
                            <button
                              type="button"
                              onClick={handleExtractOnly}
                              disabled={extracting}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#008069] bg-white hover:bg-[#F5F6F6] rounded-lg border border-[#D1D7DB] transition shadow-xs"
                              title="Run OCR / Multimodal Extraction to review text"
                            >
                              {extracting ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <ScanText className="h-3.5 w-3.5" />
                              )}
                              <span>OCR & Preview</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={handleClearFile}
                            className="p-1 text-[#667781] hover:text-[#111B21] rounded-lg hover:bg-white transition"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Text Area */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-[#111B21]">
                    {ingestMode === 'upload' && selectedFile
                      ? 'Extracted / Prepared Content (Editable)'
                      : 'Source Text (Raw Data to Chunk & Vectorize)'}
                  </label>
                  <span className="text-[11px] text-[#8696A0] font-mono">
                    ~{Math.ceil(docText.length / 4)} tokens
                  </span>
                </div>
                <textarea
                  rows={ingestMode === 'upload' && !selectedFile ? 4 : 6}
                  placeholder={
                    ingestMode === 'upload'
                      ? 'Drop a PDF, Image, Word or Text document above, or paste raw text here...'
                      : 'Paste your document text here. The semantic chunker will separate sections based on thematic shifts...'
                  }
                  value={docText}
                  onChange={(e) => setDocText(e.target.value)}
                  className="w-full rounded-xl border border-[#D1D7DB] bg-white p-3 text-xs text-[#111B21] placeholder-[#8696A0] focus:border-[#00A884] focus:outline-none focus:ring-1 focus:ring-[#00A884] transition font-mono leading-relaxed"
                />
              </div>

              {/* Semantic Chunking Explanation */}
              <div className="flex items-start gap-2 rounded-xl border border-[#E9EDEF] bg-[#F0F2F5] p-3 text-xs text-[#54656F]">
                <Info className="h-4 w-4 text-[#008069] shrink-0 mt-0.5" />
                <p>
                  <strong className="text-[#111B21]">Semantic Chunking Active:</strong> Chunks are partitioned strictly by meaning shifts rather than raw character counts. Each chunk receives a topic tag and high-dimensional vector embeddings for cosine retrieval.
                </p>
              </div>

              {ingestStatus && (
                <div className="flex items-center gap-2 rounded-xl bg-[#E7F7EF] border border-[#C3ECD7] p-3 text-xs text-[#008069]">
                  <Loader2 className="h-4 w-4 animate-spin text-[#008069]" />
                  <span>{ingestStatus}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={ingesting || (!docText.trim() && !selectedFile)}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#008069] hover:bg-[#00705B] px-4 py-3 text-xs font-semibold text-white shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {ingesting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-white" />
                    <span>Extracting, Chunking & Generating Vector Embeddings...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    <span>Ingest, Semantically Chunk & Vectorize</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Right Column: Live Semantic Search Tester (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white rounded-2xl border border-[#E9EDEF] p-6 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-[#E9EDEF] pb-4">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-[#008069]" />
                <h3 className="text-sm font-bold text-[#111B21]">Semantic Search Tester</h3>
              </div>
              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-[#E7F7EF] text-[#008069] border border-[#C3ECD7] font-semibold">
                Cosine Similarity
              </span>
            </div>

            {/* Requester Access Level Simulator */}
            <div className="space-y-2 rounded-xl border border-[#E9EDEF] bg-[#F0F2F5] p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-[#54656F] flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5 text-[#008069]" />
                  <span>Simulate User Level:</span>
                </span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${ACCESS_LEVEL_CONFIG[searchUserLevel].bg} ${ACCESS_LEVEL_CONFIG[searchUserLevel].color} ${ACCESS_LEVEL_CONFIG[searchUserLevel].border}`}>
                  {ACCESS_LEVEL_CONFIG[searchUserLevel].label}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-0.5">
                {[1, 2, 3, 4].map((lvl) => {
                  const cfg = ACCESS_LEVEL_CONFIG[lvl];
                  const Icon = cfg.icon;
                  const isSelected = searchUserLevel === lvl;
                  return (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setSearchUserLevel(lvl)}
                      className={`px-2 py-1.5 rounded-lg text-[10px] font-medium border transition text-center flex items-center justify-center gap-1 ${isSelected
                        ? `${cfg.bg} ${cfg.color} ${cfg.border} font-bold shadow-xs`
                        : 'bg-white text-[#54656F] border-[#D1D7DB] hover:text-[#111B21] hover:bg-[#F5F6F6]'
                        }`}
                    >
                      <Icon className="h-3 w-3 shrink-0" />
                      <span>L{lvl}: {cfg.name.toUpperCase()}</span>
                    </button>
                  );
                })}
              </div>

              <p className="text-[10px] text-[#667781] leading-tight flex items-center gap-1">
                {searchUserLevel === 1 ? (
                  <>
                    <Lock className="h-3 w-3 text-emerald-600 shrink-0" />
                    <span><strong className="text-emerald-700">WhatsApp Customer:</strong> Only Level 1 public chunks reach model. Confidential chunks are filtered out.</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-3 w-3 text-[#008069] shrink-0" />
                    <span><strong className="text-[#008069]">Elevated Staff/Admin:</strong> Chunks up to Level {searchUserLevel} ({ACCESS_LEVEL_CONFIG[searchUserLevel].name}) authorized.</span>
                  </>
                )}
              </p>
            </div>

            <form onSubmit={handleSearch} className="space-y-3">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Test a query, e.g. 'Can I return an item after 20 days?'"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-xl border border-[#D1D7DB] bg-white pl-3.5 pr-10 py-2.5 text-xs text-[#111B21] placeholder-[#8696A0] focus:border-[#00A884] focus:outline-none focus:ring-1 focus:ring-[#00A884] transition"
                />
                <button
                  type="submit"
                  disabled={searching || !searchQuery.trim()}
                  className="absolute right-2 top-2 p-1 text-[#667781] hover:text-[#008069] disabled:opacity-30 transition"
                >
                  {searching ? (
                    <Loader2 className="h-4 w-4 animate-spin text-[#008069]" />
                  ) : (
                    <ArrowRight className="h-4 w-4" />
                  )}
                </button>
              </div>

              <div className="flex gap-1.5 flex-wrap">
                {['Can I get a refund?', 'What is our API key?', 'Employee salaries', 'Database password'].map(
                  (example, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setSearchQuery(example)}
                      className="text-[10px] truncate px-2 py-1 rounded-lg bg-white text-[#54656F] hover:text-[#111B21] hover:bg-[#F5F6F6] border border-[#D1D7DB] hover:border-[#00A884] transition shadow-xs"
                    >
                      {example}
                    </button>
                  )
                )}
              </div>
            </form>

            {/* Results Display */}
            <div className="mt-4 space-y-3">
              {searchResults && searchResults.length === 0 && (
                <div className="text-center py-6 rounded-xl border border-dashed border-[#D1D7DB] text-[#667781] text-xs space-y-1">
                  <p>No authorized semantic matches found for Level {searchUserLevel} ({ACCESS_LEVEL_CONFIG[searchUserLevel].name}).</p>
                  <p className="text-[11px] text-[#8696A0]">
                    If confidential chunks exist for this query, they were strictly blocked from model context.
                  </p>
                </div>
              )}

              {searchResults && searchResults.length > 0 && (
                <div className="space-y-2.5">
                  <div className="text-xs font-semibold text-[#54656F] flex items-center justify-between">
                    <span>Authorized Chunks ({searchResults.length})</span>
                    <span className="text-[10px] text-emerald-700 font-mono">Ranked by Cosine Score</span>
                  </div>

                  {searchResults.map((match, idx) => {
                    const matchLvl = match.accessLevel || 1;
                    const matchCfg = ACCESS_LEVEL_CONFIG[matchLvl] || ACCESS_LEVEL_CONFIG[1];
                    const LevelIcon = matchCfg.icon;

                    return (
                      <div
                        key={idx}
                        className="rounded-xl border border-[#E9EDEF] bg-[#F0F2F5] p-3 space-y-2 hover:border-[#00A884] transition shadow-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-[#111B21] truncate">
                            {match.topic}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border flex items-center gap-1 ${matchCfg.bg} ${matchCfg.color} ${matchCfg.border}`}>
                              <LevelIcon className="h-2.5 w-2.5" />
                              <span>{matchCfg.name.toUpperCase()}</span>
                            </span>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                              {(match.similarity * 100).toFixed(1)}% Match
                            </span>
                          </div>
                        </div>

                        {match.metadata?.sensitivityFlags && match.metadata.sensitivityFlags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {match.metadata.sensitivityFlags.map((flag: string, fIdx: number) => (
                              <span key={fIdx} className="text-[9px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1">
                                <Lock className="h-2.5 w-2.5" />
                                <span>{flag}</span>
                              </span>
                            ))}
                          </div>
                        )}

                        <p className="text-xs text-[#54656F] line-clamp-3 leading-relaxed">
                          {match.content}
                        </p>
                        <div className="flex items-center justify-between pt-1 border-t border-[#E9EDEF] text-[10px] text-[#8696A0]">
                          <span>Doc: {match.documentTitle}</span>
                          <span>~{match.tokenCount} tokens</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Section: Knowledge Base Documents List */}
      <div className="bg-white rounded-2xl border border-[#E9EDEF] p-6 space-y-4 shadow-sm">
        <div className="flex items-center justify-between border-b border-[#E9EDEF] pb-4">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-[#008069]" />
            <h3 className="text-sm font-bold text-[#111B21]">Indexed Knowledge Base Documents</h3>
            <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-[#E7F7EF] text-[#008069] border border-[#C3ECD7] font-mono font-semibold">
              {documents.length}
            </span>
          </div>

          <button
            onClick={onRefreshDocs}
            disabled={loadingDocs}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-[#F5F6F6] border border-[#D1D7DB] text-[#54656F] hover:text-[#111B21] text-xs font-medium transition shadow-xs"
          >
            {loadingDocs ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#008069]" />
            ) : (
              <Layers className="h-3.5 w-3.5 text-[#008069]" />
            )}
            <span>Refresh</span>
          </button>
        </div>

        {documents.length === 0 ? (
          <div className="text-center py-10 border border-dashed border-[#D1D7DB] rounded-xl space-y-2">
            <FileText className="h-7 w-7 text-[#8696A0] mx-auto" />
            <p className="text-xs text-[#54656F]">Knowledge base is currently empty.</p>
            <p className="text-[11px] text-[#8696A0]">
              Use the Knowledge Ingestion Station above to feed documents (PDF, Word, TXT), images, or text.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#54656F]">
              <thead className="bg-[#F0F2F5] text-[11px] text-[#667781] uppercase tracking-wider border-b border-[#E9EDEF]">
                <tr>
                  <th className="py-3 px-4">Title</th>
                  <th className="py-3 px-4">Source</th>
                  <th className="py-3 px-4">Access Level</th>
                  <th className="py-3 px-4">Semantic Chunks</th>
                  <th className="py-3 px-4">Indexed At</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E9EDEF]">
                {documents.map((doc) => {
                  const docLvl = doc.accessLevel || 1;
                  const docCfg = ACCESS_LEVEL_CONFIG[docLvl] || ACCESS_LEVEL_CONFIG[1];
                  const LevelIcon = docCfg.icon;

                  return (
                    <tr key={doc.id} className="hover:bg-[#F5F6F6] transition-colors">
                      <td className="py-3.5 px-4 font-semibold text-[#111B21] max-w-xs truncate">
                        {doc.title}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md bg-[#F0F2F5] border border-[#E9EDEF] text-[#54656F] font-semibold">
                          {doc.source}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`text-[10px] px-2 py-0.5 rounded-md border font-semibold inline-flex items-center gap-1 ${docCfg.bg} ${docCfg.color} ${docCfg.border}`}>
                          <LevelIcon className="h-3 w-3" />
                          <span>{docCfg.label}</span>
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs">
                        <span className="px-2 py-0.5 rounded bg-[#E7F7EF] border border-[#C3ECD7] text-[#008069] font-bold">
                          {doc.chunkCount} chunks
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-[11px] text-[#8696A0]">
                        {new Date(doc.createdAt).toLocaleDateString()} {new Date(doc.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-3.5 px-4 text-right space-x-2">
                        <button
                          onClick={() => handleOpenChunks(doc)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#008069] bg-[#E7F7EF] hover:bg-[#C3ECD7] border border-[#C3ECD7] rounded-lg transition"
                          title="Inspect Chunks & Vector Details"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>Inspect Chunks</span>
                        </button>
                        <button
                          onClick={() => onDeleteDocument(doc.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition"
                          title="Delete Document"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Delete</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Semantic Chunks Inspector Modal */}
      {inspectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-4xl max-h-[85vh] flex flex-col rounded-2xl border border-[#E9EDEF] bg-white shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-[#E9EDEF] px-6 py-4 bg-white">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-[#E7F7EF] border border-[#C3ECD7] flex items-center justify-center text-[#008069]">
                  <Layers className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold text-[#111B21] text-sm sm:text-base">
                    Semantic Chunks: {inspectingDoc?.title}
                  </h3>
                  <p className="text-[11px] text-[#667781]">
                    Topic-segmented chunks with permission levels & vector embeddings
                  </p>
                </div>
              </div>
              <button
                onClick={() => setInspectModalOpen(false)}
                className="rounded-lg p-1.5 text-[#667781] hover:bg-[#F5F6F6] hover:text-[#111B21] transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-[#F0F2F5]">
              {loadingChunks ? (
                <div className="flex flex-col items-center justify-center py-12 space-y-3">
                  <Loader2 className="h-7 w-7 animate-spin text-[#008069]" />
                  <p className="text-xs text-[#667781]">Loading semantic chunks and vectors...</p>
                </div>
              ) : !Array.isArray(inspectingChunks) || inspectingChunks.length === 0 ? (
                <p className="text-xs text-[#8696A0] text-center py-8">No chunks found for this document.</p>
              ) : (
                inspectingChunks.map((chunk, index) => {
                  const chkLvl = chunk.accessLevel || 1;
                  const chkCfg = ACCESS_LEVEL_CONFIG[chkLvl] || ACCESS_LEVEL_CONFIG[1];
                  const LevelIcon = chkCfg.icon;

                  return (
                    <div
                      key={chunk.id || index}
                      className="rounded-xl border border-[#E9EDEF] bg-white p-4 space-y-2.5 shadow-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E9EDEF] pb-2.5">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#E7F7EF] text-[#008069] text-[10px] font-bold border border-[#C3ECD7]">
                            {chunk.chunkIndex + 1}
                          </span>
                          <span className="text-xs font-bold text-[#111B21] flex items-center gap-1.5">
                            <Tag className="h-3 w-3 text-[#008069]" />
                            <span>Topic: {chunk.topic}</span>
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          {/* Access Level Badge */}
                          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${chkCfg.bg} ${chkCfg.color} ${chkCfg.border}`}>
                            <LevelIcon className="h-2.5 w-2.5" />
                            <span>{chkCfg.label}</span>
                          </span>

                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Vector Active
                          </span>
                          <span className="text-[10px] font-mono text-[#8696A0]">
                            ~{chunk.tokenCount} tokens
                          </span>
                        </div>
                      </div>

                      {/* Sensitivity Tags & Detection Reasons */}
                      {chunk.metadata?.sensitivityFlags && chunk.metadata.sensitivityFlags.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 bg-rose-50 border border-rose-200 rounded-lg p-2">
                          <span className="text-[10px] font-semibold text-rose-700 flex items-center gap-1">
                            <ShieldAlert className="h-3 w-3" />
                            <span>Detected Sensitivity:</span>
                          </span>
                          {chunk.metadata.sensitivityFlags.map((flag: string, fIdx: number) => (
                            <span key={fIdx} className="text-[9px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-300 font-medium">
                              {flag}
                            </span>
                          ))}
                          {chunk.metadata?.detectedReasons && chunk.metadata.detectedReasons.length > 0 && (
                            <span className="text-[10px] text-[#667781] italic ml-1">
                              ({chunk.metadata.detectedReasons.join(', ')})
                            </span>
                          )}
                        </div>
                      )}

                      <p className="text-xs text-[#111B21] whitespace-pre-wrap leading-relaxed font-mono text-[11px] bg-[#F0F2F5] p-3 rounded-lg border border-[#E9EDEF]">
                        {chunk.content}
                      </p>
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal Footer */}
            <div className="border-t border-[#E9EDEF] px-6 py-3.5 bg-white flex justify-end">
              <button
                type="button"
                onClick={() => setInspectModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-[#008069] hover:bg-[#00705B] text-white text-xs font-medium transition shadow-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
