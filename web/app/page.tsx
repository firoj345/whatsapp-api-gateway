'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from '../components/Header';
import { ToastContainer, ToastMessage, ToastType } from '../components/Toast';
import { SessionsTab, SessionData } from '../components/tabs/SessionsTab';
import { MessagesTab, ChatMessageItem, ConversationMessageItem } from '../components/tabs/MessagesTab';
import { ApiKeysTab, ApiKeyItem } from '../components/tabs/ApiKeysTab';
import { SafetyTab } from '../components/tabs/SafetyTab';
import { RagTab, DocumentItem, ChunkItem, SearchMatch } from '../components/tabs/RagTab';

import { QrModal } from '../components/modals/QrModal';
import { NewSessionModal } from '../components/modals/NewSessionModal';
import { NewKeyModal } from '../components/modals/NewKeyModal';
import { ApiKeySuccessModal } from '../components/modals/ApiKeySuccessModal';
import { ConfirmModal } from '../components/modals/ConfirmModal';

import {
  Smartphone,
  MessageSquare,
  Brain,
  Key,
  ShieldCheck
} from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://klizo-api-gateway.onrender.com';

function mergeConversationMessages(current: ConversationMessageItem[], incoming: ConversationMessageItem[]) {
  const messagesById = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) messagesById.set(message.id, message);
  return Array.from(messagesById.values())
    .sort((first, second) => Date.parse(first.createdAt) - Date.parse(second.createdAt))
    .slice(-500);
}

function normalizeChatId(chatId: string) {
  if (chatId.includes('@')) return chatId;
  const digits = chatId.replace(/\D/g, '');
  return digits ? `${digits}@s.whatsapp.net` : chatId;
}

export default function DashboardPage() {
  const [apiKey, setApiKey] = useState('wag_live_admin_secret_key_demo_12345');
  const [activeTab, setActiveTab] = useState<'sessions' | 'messages' | 'rag' | 'keys' | 'safety'>('sessions');

  // Toasts
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const addToast = (type: ToastType, title: string, message?: string) => {
    const id = `toast_${Date.now()}_${Math.random()}`;
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // State data
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [activeChat, setActiveChat] = useState<ChatMessageItem | null>(null);
  const activeChatRef = useRef<ChatMessageItem | null>(null);
  const [conversationMessages, setConversationMessages] = useState<ConversationMessageItem[]>([]);
  const [conversationLoading, setConversationLoading] = useState(false);

  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);

  const [ragDocuments, setRagDocuments] = useState<DocumentItem[]>([]);
  const [ragDocsLoading, setRagDocsLoading] = useState(false);

  // Modals state
  const [isNewSessionOpen, setIsNewSessionOpen] = useState(false);
  const [isQrOpen, setIsQrOpen] = useState(false);
  const [qrSessionId, setQrSessionId] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrStatus, setQrStatus] = useState('QR_PENDING');
  const qrIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [isNewKeyOpen, setIsNewKeyOpen] = useState(false);
  const [isKeySuccessOpen, setIsKeySuccessOpen] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState('');

  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{
    title: string;
    message: string;
    action: () => Promise<void>;
  }>({
    title: '',
    message: '',
    action: async () => {}
  });

  // Initialize API Key from localStorage or default to master key
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('wag_admin_key');
      if (stored && stored.startsWith('wag_live_admin_')) {
        setApiKey(stored);
      } else if (stored) {
        // Clear any scoped non-admin key so master admin key is used
        localStorage.removeItem('wag_admin_key');
      }
    }
  }, []);

  const getHeaders = useCallback((includeContentType = true) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`
    };
    if (includeContentType) {
      headers['Content-Type'] = 'application/json';
    }
    return headers;
  }, [apiKey]);

  // Fetch functions
  const fetchSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/sessions`, { headers: getHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSessions(Array.isArray(data) ? data : []);
    } catch (err: any) {
      addToast('error', 'Failed to load sessions', err.message);
    } finally {
      setSessionsLoading(false);
    }
  }, [getHeaders]);

  const fetchMessages = useCallback(async () => {
    setMessagesLoading(true);
    try {
      const sessRes = await fetch(`${API_BASE}/sessions`, { headers: getHeaders() });
      if (!sessRes.ok) throw new Error(`HTTP ${sessRes.status}`);
      const sessData = await sessRes.json();
      if (!Array.isArray(sessData) || sessData.length === 0) {
        setMessages([]);
        return;
      }
      const sessionFeeds = await Promise.all(sessData.map(async (session: SessionData) => {
        const res = await fetch(`${API_BASE}/sessions/${encodeURIComponent(session.id)}/chats`, { headers: getHeaders() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return (Array.isArray(data) ? data : []).map((chat: ChatMessageItem) => ({ ...chat, sessionId: session.id }));
      }));
      setMessages(sessionFeeds.flat().sort((first, second) => Date.parse(second.lastTimestamp) - Date.parse(first.lastTimestamp)).slice(0, 50));
    } catch (err: any) {
      addToast('error', 'Failed to load chat stream', err.message);
    } finally {
      setMessagesLoading(false);
    }
  }, [getHeaders]);

  const openConversation = useCallback(async (chat: ChatMessageItem) => {
    if (!chat.sessionId) return;
    activeChatRef.current = chat;
    setActiveChat(chat);
    setConversationMessages([]);
    setConversationLoading(true);
    try {
      const endpoint = `${API_BASE}/sessions/${encodeURIComponent(chat.sessionId)}/chats/${encodeURIComponent(chat.chatJid)}/messages?limit=500`;
      const response = await fetch(endpoint, { headers: getHeaders() });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (Array.isArray(data)) {
        setConversationMessages((current) => mergeConversationMessages(current, data));
      }
    } catch (err: any) {
      addToast('error', 'Failed to load conversation', err.message);
    } finally {
      setConversationLoading(false);
    }
  }, [getHeaders]);

  const closeConversation = () => {
    activeChatRef.current = null;
    setActiveChat(null);
    setConversationMessages([]);
  };

  const fetchApiKeys = useCallback(async () => {
    setKeysLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/keys`, { headers: getHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setApiKeys(Array.isArray(data) ? data : []);
    } catch (err: any) {
      addToast('error', 'Failed to load API keys', err.message);
    } finally {
      setKeysLoading(false);
    }
  }, [getHeaders]);

  const fetchRagDocuments = useCallback(async () => {
    setRagDocsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/rag/documents`, { headers: getHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRagDocuments(Array.isArray(data) ? data : []);
    } catch (err: any) {
      addToast('error', 'Failed to load RAG documents', err.message);
    } finally {
      setRagDocsLoading(false);
    }
  }, [getHeaders]);

  // Tab switch hook
  useEffect(() => {
    if (activeTab === 'sessions') fetchSessions();
    if (activeTab === 'messages') fetchSessions();
    if (activeTab === 'rag') fetchRagDocuments();
    if (activeTab === 'keys') fetchApiKeys();
  }, [activeTab, fetchSessions, fetchRagDocuments, fetchApiKeys]);

  useEffect(() => {
    if (activeTab !== 'messages' || sessions.length === 0) return;

    const controller = new AbortController();
    const connectToSession = async (session: SessionData) => {
      while (!controller.signal.aborted) {
        try {
          const response = await fetch(`${API_BASE}/sessions/${encodeURIComponent(session.id)}/chats/stream`, {
            headers: { ...getHeaders(), Accept: 'text/event-stream' },
            signal: controller.signal
          });
          if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (!controller.signal.aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const frames = buffer.split(/\r?\n\r?\n/);
            buffer = frames.pop() || '';

            for (const frame of frames) {
              const event = frame.match(/^event:\s*(.+)$/m)?.[1]?.trim();
              const data = frame.split(/\r?\n/)
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.slice(5).trim())
                .join('\n');
              if (!event || !data) continue;

              const payload = JSON.parse(data);
              if (event === 'snapshot' && Array.isArray(payload)) {
                const snapshot = payload as ChatMessageItem[];
                setMessages((current) => [
                  ...current.filter((chat) => chat.sessionId !== session.id),
                  ...snapshot
                ].sort((first, second) => Date.parse(second.lastTimestamp) - Date.parse(first.lastTimestamp)).slice(0, 50));
                const selectedChat = activeChatRef.current;
                const updatedChat = snapshot.find((chat) =>
                  selectedChat?.sessionId === session.id &&
                  normalizeChatId(chat.chatJid) === normalizeChatId(selectedChat.chatJid)
                );
                if (updatedChat && selectedChat) {
                  const mergedChat = { ...selectedChat, ...updatedChat };
                  activeChatRef.current = mergedChat;
                  setActiveChat(mergedChat);
                }
              } else if (event === 'chat') {
                const incoming = payload as ChatMessageItem;
                setMessages((current) => [
                  ...current.filter((chat) => chat.sessionId !== session.id || chat.chatJid !== incoming.chatJid),
                  incoming
                ].sort((first, second) => Date.parse(second.lastTimestamp) - Date.parse(first.lastTimestamp)).slice(0, 50));
                const selectedChat = activeChatRef.current;
                if (
                  selectedChat?.sessionId === session.id &&
                  normalizeChatId(selectedChat.chatJid) === normalizeChatId(incoming.chatJid)
                ) {
                  const mergedChat = { ...selectedChat, ...incoming };
                  activeChatRef.current = mergedChat;
                  setActiveChat(mergedChat);
                }
              } else if (event === 'message') {
                const incoming = payload as ConversationMessageItem;
                const selectedChat = activeChatRef.current;
                if (selectedChat?.sessionId === incoming.sessionId && normalizeChatId(selectedChat.chatJid) === normalizeChatId(incoming.chatJid)) {
                  setConversationMessages((current) => mergeConversationMessages(current, [incoming]));
                }
              }
            }
          }
          reader.releaseLock();
        } catch {
          if (controller.signal.aborted) return;
        }

        if (!controller.signal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    };

    for (const session of sessions) void connectToSession(session);
    return () => {
      controller.abort();
    };
  }, [activeTab, getHeaders, sessions]);

  // Action handlers
  const handleSaveApiKey = (newKey: string) => {
    setApiKey(newKey);
    if (typeof window !== 'undefined') {
      localStorage.setItem('wag_admin_key', newKey);
    }
    addToast('success', 'API Key Updated', 'New authorization token saved for this console.');
  };

  const handleCreateSession = async (id: string, name: string) => {
    try {
      const res = await fetch(`${API_BASE}/sessions`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ id, name })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      addToast('success', 'Session Created', `Session ${id} initialized.`);
      await fetchSessions();
      handleOpenQr(id);
    } catch (err: any) {
      addToast('error', 'Failed to create session', err.message);
    }
  };

  const handleOpenQr = (sessionId: string) => {
    setQrSessionId(sessionId);
    setQrDataUrl(null);
    setQrStatus('QR_PENDING');
    setIsQrOpen(true);

    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/sessions/${sessionId}`, { headers: getHeaders() });
        if (res.ok) {
          const data = await res.json();
          if (data.qrDataUrl) {
            setQrDataUrl(data.qrDataUrl);
          }
          if (data.status) {
            setQrStatus(data.status);
          }
          if (data.status === 'CONNECTED') {
            addToast('success', 'Device Connected', `Session ${sessionId} paired successfully!`);
            fetchSessions();
            if (qrIntervalRef.current) clearInterval(qrIntervalRef.current);
            setTimeout(() => setIsQrOpen(false), 1500);
          }
        }
      } catch {}
    };

    poll();
    if (qrIntervalRef.current) clearInterval(qrIntervalRef.current);
    qrIntervalRef.current = setInterval(poll, 3000);
  };

  const handleCloseQr = () => {
    setIsQrOpen(false);
    if (qrIntervalRef.current) {
      clearInterval(qrIntervalRef.current);
      qrIntervalRef.current = null;
    }
  };

  const handleLogoutSession = (session: SessionData) => {
    setConfirmConfig({
      title: `Logout Session ${session.name}?`,
      message: `Are you sure you want to disconnect and delete session "${session.id}"? All credentials will be safely wiped.`,
      action: async () => {
        try {
          const res = await fetch(`${API_BASE}/sessions/${session.id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${apiKey}` }
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          addToast('info', 'Session Logged Out', `Session ${session.id} has been removed.`);
          fetchSessions();
        } catch (err: any) {
          addToast('error', 'Logout Failed', err.message);
        }
      }
    });
    setIsConfirmOpen(true);
  };

  const handleSendMessage = async (payload: {
    sessionId: string;
    to: string;
    type: 'text' | 'image' | 'document' | 'voice';
    content: string;
    mediaUrl?: string;
  }) => {
    const { sessionId, to, type, content, mediaUrl } = payload;
    let digits = to.replace(/\D/g, '');
    let normalizedTo = to;
    if (digits.length === 10 && /^[6-9]/.test(digits)) {
      normalizedTo = `91${digits}`;
    }

    const endpoint = `${API_BASE}/sessions/${sessionId}/messages/${type}`;
    let body: any = { to: normalizedTo };
    if (type === 'text') body.text = content;
    else if (type === 'image') { body.image = mediaUrl; body.caption = content; }
    else if (type === 'document') { body.document = mediaUrl; body.caption = content; }
    else if (type === 'voice') { body.audio = mediaUrl; }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { ...getHeaders(), 'Idempotency-Key': `idemp_${Date.now()}` },
      body: JSON.stringify(body)
    });

    const data = await res.json().catch(() => ({}));
    if (res.status === 202) {
      addToast(
        'success',
        'Message Enqueued (202 Accepted)',
        `ID: ${data.messageId}. Rate pacing & anti-ban typing simulation active.`
      );
      setTimeout(fetchMessages, 2500);
    } else {
      throw new Error(data.message || 'Delivery request rejected by gateway');
    }
  };

  const handleGenerateKey = async (name: string, scopes: string[], rateLimitRpm: number) => {
    const res = await fetch(`${API_BASE}/auth/keys`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name, scopes, rateLimitRpm })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Key generation failed');
    }
    const data = await res.json();
    setNewlyCreatedKey(data.apiKey);
    setIsKeySuccessOpen(true);
    fetchApiKeys();
  };

  const handleRevokeKey = (key: ApiKeyItem) => {
    setConfirmConfig({
      title: `Revoke API Key "${key.name}"?`,
      message: `This will permanently disable and delete Bearer token "${key.prefix}...". Any integration using it will immediately receive 401 Unauthorized.`,
      action: async () => {
        try {
          const res = await fetch(`${API_BASE}/auth/keys/${key.id}`, {
            method: 'DELETE',
            headers: getHeaders(false)
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.message || `HTTP ${res.status}`);
          }
          addToast('success', 'Key Revoked', `Token ${key.prefix}... has been revoked.`);
          await fetchApiKeys();
        } catch (err: any) {
          addToast('error', 'Revocation Failed', err.message);
        }
      }
    });
    setIsConfirmOpen(true);
  };

  // RAG Pipeline action handlers
  const handleIngestDocument = async (payload: {
    title?: string;
    source?: string;
    text?: string;
    accessLevel?: number;
    fileBase64?: string;
    filename?: string;
    mimeType?: string;
    maxTokensPerChunk?: number;
  }) => {
    try {
      const res = await fetch(`${API_BASE}/rag/documents`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const displayTitle = payload.title || payload.filename || 'Document';
      addToast('success', 'Document Ingested & Vectorized', `"${displayTitle}" indexed with ${data.chunkCount} semantic chunks.`);
      await fetchRagDocuments();
      return data;
    } catch (err: any) {
      addToast('error', 'RAG Ingestion Failed', err.message);
      throw err;
    }
  };

  const handleExtractFile = async (payload: {
    fileBase64: string;
    filename: string;
    mimeType?: string;
  }) => {
    try {
      const res = await fetch(`${API_BASE}/rag/extract`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'File extraction failed');
      }
      const data = await res.json();
      addToast('success', 'File Extracted', `Parsed ~${data.tokenEstimate} tokens from "${payload.filename}".`);
      return data;
    } catch (err: any) {
      addToast('error', 'File Extraction Failed', err.message);
      throw err;
    }
  };

  const handleDeleteDocument = async (id: string) => {
    setConfirmConfig({
      title: 'Delete Knowledge Document?',
      message: 'This will permanently remove the document and all associated 768d vector embeddings from the Vector Database.',
      action: async () => {
        try {
          const res = await fetch(`${API_BASE}/rag/documents/${id}`, {
            method: 'DELETE',
            headers: getHeaders(false)
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          addToast('info', 'Document Removed', 'Document and vector embeddings deleted.');
          await fetchRagDocuments();
        } catch (err: any) {
          addToast('error', 'Deletion Failed', err.message);
        }
      }
    });
    setIsConfirmOpen(true);
  };

  const handleFetchChunks = async (documentId: string) => {
    const res = await fetch(`${API_BASE}/rag/documents/${documentId}/chunks`, {
      headers: getHeaders()
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : (data.chunks || []);
  };

  const handleSemanticSearch = async (query: string, userAccessLevel: number = 1): Promise<SearchMatch[]> => {
    const res = await fetch(`${API_BASE}/rag/query`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ query, topK: 4, minSimilarity: 0.35, userAccessLevel })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Search failed');
    }
    const data = await res.json();
    return data.results || [];
  };

  const tabList = [
    { id: 'sessions', label: 'Sessions & QR', icon: Smartphone },
    { id: 'messages', label: 'Send & Live Feed', icon: MessageSquare },
    { id: 'rag', label: 'RAG & Vector Store', icon: Brain },
    { id: 'keys', label: 'API Keys & ACL', icon: Key },
    { id: 'safety', label: 'Anti-Ban & Pacing', icon: ShieldCheck }
  ] as const;

  return (
    <div className="min-h-screen flex flex-col bg-[#F0F2F5] text-[#111B21]">
      {/* Top Header */}
      <Header apiBase={API_BASE} />

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto w-full p-4 sm:p-6 flex-1 space-y-6">
        {/* Navigation Tabs Bar */}
        <div className="flex space-x-6 border-b border-[#E9EDEF] overflow-x-auto no-scrollbar">
          {tabList.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 pb-3.5 pt-1 px-1 text-sm whitespace-nowrap transition-all duration-200 border-b-2 -mb-[1px] ${
                  isActive
                    ? 'text-[#008069] border-[#008069] font-semibold'
                    : 'text-[#54656F] hover:text-[#111B21] border-transparent font-medium'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-[#008069]' : 'text-[#54656F]'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Sections */}
        {activeTab === 'sessions' && (
          <SessionsTab
            sessions={sessions}
            loading={sessionsLoading}
            onRefresh={fetchSessions}
            onOpenNewSession={() => setIsNewSessionOpen(true)}
            onViewQr={handleOpenQr}
            onLogoutSession={handleLogoutSession}
          />
        )}

        {activeTab === 'messages' && (
          <MessagesTab
            sessions={sessions}
            messages={messages}
            activeChat={activeChat}
            conversationMessages={conversationMessages}
            conversationLoading={conversationLoading}
            feedLoading={messagesLoading}
            onRefreshFeed={fetchMessages}
            onOpenChat={openConversation}
            onCloseChat={closeConversation}
            onSendMessage={handleSendMessage}
          />
        )}

        {activeTab === 'rag' && (
          <RagTab
            documents={ragDocuments}
            loadingDocs={ragDocsLoading}
            onRefreshDocs={fetchRagDocuments}
            onIngestDocument={handleIngestDocument}
            onDeleteDocument={handleDeleteDocument}
            onFetchChunks={handleFetchChunks}
            onSemanticSearch={handleSemanticSearch}
            onExtractFile={handleExtractFile}
          />
        )}

        {activeTab === 'keys' && (
          <ApiKeysTab
            apiKeys={apiKeys}
            loading={keysLoading}
            onRefresh={fetchApiKeys}
            onOpenNewKeyModal={() => setIsNewKeyOpen(true)}
            onRevokeKey={handleRevokeKey}
          />
        )}

        {activeTab === 'safety' && <SafetyTab />}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#E9EDEF] py-4 px-6 text-center text-xs text-[#667781] font-mono bg-white">
        WhatsApp API Gateway • High-Performance Self-Hosted Engine • Next.js & Fastify
      </footer>

      {/* Global Modals */}
      <QrModal
        isOpen={isQrOpen}
        onClose={handleCloseQr}
        qrDataUrl={qrDataUrl}
        status={qrStatus}
      />

      <NewSessionModal
        isOpen={isNewSessionOpen}
        onClose={() => setIsNewSessionOpen(false)}
        onSubmit={handleCreateSession}
      />

      <NewKeyModal
        isOpen={isNewKeyOpen}
        onClose={() => setIsNewKeyOpen(false)}
        onSubmit={handleGenerateKey}
      />

      <ApiKeySuccessModal
        isOpen={isKeySuccessOpen}
        onClose={() => {
          setIsKeySuccessOpen(false);
          setNewlyCreatedKey('');
        }}
        apiKey={newlyCreatedKey}
      />

      <ConfirmModal
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        onConfirm={confirmConfig.action}
        title={confirmConfig.title}
        message={confirmConfig.message}
      />

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
}
