'use client';

import React, { useState, useRef, useEffect } from 'react';
import { SessionData } from './SessionsTab';
import {
  Send,
  MessageSquare,
  ChevronLeft,
  Image as ImageIcon,
  FileText,
  Mic,
  RefreshCw,
  Clock,
  Loader2,
  ExternalLink,
  Download,
  X,
  Maximize2,
  MoreVertical,
  Smile,
  Paperclip,
  CheckCheck
} from 'lucide-react';

export interface ChatMessageItem {
  sessionId?: string;
  chatJid: string;
  displayName?: string;
  profilePictureUrl?: string | null;
  lastMessage?: string | null;
  lastTimestamp: string;
}

export interface ConversationMessageItem {
  id: string;
  sessionId: string;
  chatJid: string;
  direction: 'inbound' | 'outbound';
  type: string;
  content: string | null;
  mediaUrl?: string | null;
  status: string;
  createdAt: string;
}

interface MessagesTabProps {
  sessions: SessionData[];
  messages: ChatMessageItem[];
  activeChat: ChatMessageItem | null;
  conversationMessages: ConversationMessageItem[];
  conversationLoading: boolean;
  feedLoading: boolean;
  onRefreshFeed: () => void;
  onOpenChat: (chat: ChatMessageItem) => void;
  onCloseChat: () => void;
  onSendMessage: (payload: {
    sessionId: string;
    to: string;
    type: 'text' | 'image' | 'document' | 'voice';
    content: string;
    mediaUrl?: string;
  }) => Promise<void>;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://klizo-api-gateway.onrender.com';

function resolveMediaUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
    return url;
  }
  const cleanBase = API_BASE.replace(/\/+$/, '');
  const cleanPath = url.startsWith('/') ? url : `/${url}`;
  return `${cleanBase}${cleanPath}`;
}

function isImageMedia(msg: ConversationMessageItem): boolean {
  if (msg.type === 'image') return true;
  if (!msg.mediaUrl) return false;
  return /\.(jpg|jpeg|png|webp|gif|avif)($|\?)/i.test(msg.mediaUrl) || msg.mediaUrl.includes('image');
}

function isVoiceMedia(msg: ConversationMessageItem): boolean {
  if (msg.type === 'voice' || msg.type === 'audio') return true;
  if (!msg.mediaUrl) return false;
  return /\.(ogg|mp3|wav|m4a|aac|opus)($|\?)/i.test(msg.mediaUrl) || msg.mediaUrl.includes('voice') || msg.mediaUrl.includes('audio');
}

function getInitials(name?: string, jid?: string): string {
  const text = name || jid || 'WA';
  const clean = text.replace(/[^a-zA-Z0-9\s]/g, '').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  if (clean.length > 0) return clean.slice(0, 2).toUpperCase();
  return 'WA';
}

function formatChatTime(dateString: string): string {
  try {
    return new Date(dateString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export const MessagesTab: React.FC<MessagesTabProps> = ({
  sessions,
  messages,
  activeChat,
  conversationMessages,
  conversationLoading,
  feedLoading,
  onRefreshFeed,
  onOpenChat,
  onCloseChat,
  onSendMessage
}) => {
  const [selectedSession, setSelectedSession] = useState(sessions.find((session) => session.status === 'CONNECTED')?.id || sessions[0]?.id || '');
  const [recipient, setRecipient] = useState('');
  const [msgType, setMsgType] = useState<'text' | 'image' | 'document' | 'voice'>('text');
  const [mediaUrl, setMediaUrl] = useState('');
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);

  // Quick reply input inside active chat view
  const [quickReplyText, setQuickReplyText] = useState('');
  const [quickSending, setQuickSending] = useState(false);

  // Full-screen image lightbox
  const [selectedLightboxImage, setSelectedLightboxImage] = useState<string | null>(null);

  const messageListEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to latest message in active chat
  useEffect(() => {
    if (activeChat && conversationMessages.length > 0) {
      messageListEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [conversationMessages.length, activeChat]);

  // Sync selected session if empty
  useEffect(() => {
    if (!sessions.some((session) => session.id === selectedSession) && sessions.length > 0) {
      setSelectedSession(sessions.find((session) => session.status === 'CONNECTED')?.id || sessions[0].id);
    }
  }, [sessions, selectedSession]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSession || !recipient.trim()) return;

    setSending(true);
    try {
      await onSendMessage({
        sessionId: selectedSession,
        to: recipient.trim(),
        type: msgType,
        content: content.trim(),
        mediaUrl: mediaUrl.trim() || undefined
      });
      setContent('');
      setMediaUrl('');
    } finally {
      setSending(false);
    }
  };

  const handleQuickSend = async () => {
    if (!activeChat || !quickReplyText.trim() || quickSending) return;
    const currentSessionId = activeChat.sessionId || selectedSession;
    if (!currentSessionId) return;

    setQuickSending(true);
    try {
      await onSendMessage({
        sessionId: currentSessionId,
        to: activeChat.chatJid,
        type: 'text',
        content: quickReplyText.trim()
      });
      setQuickReplyText('');
    } finally {
      setQuickSending(false);
    }
  };

  const handleSelectChat = (chat: ChatMessageItem) => {
    if (chat.sessionId) setSelectedSession(chat.sessionId);
    const rawNumber = chat.displayName?.replace(/\D/g, '') || chat.chatJid.replace(/\D/g, '');
    setRecipient(rawNumber || chat.chatJid);
    onOpenChat(chat);
  };

  return (
    <>
      {/* Lightbox Modal for Image Zoom */}
      {selectedLightboxImage && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setSelectedLightboxImage(null)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setSelectedLightboxImage(null)}
              className="absolute -top-10 right-0 text-white/80 hover:text-white bg-black/50 hover:bg-black/80 rounded-full p-1.5 transition"
              title="Close Preview"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={selectedLightboxImage}
              alt="Full Preview"
              className="max-h-[80vh] w-auto rounded-xl object-contain shadow-2xl border border-white/20"
            />
            <div className="mt-3 flex items-center gap-3">
              <a
                href={selectedLightboxImage}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs bg-[#008069] hover:bg-[#00705B] text-white font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 transition shadow"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open Full Original</span>
              </a>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* REST Message Composer */}
        <div className="lg:col-span-5 bg-white rounded-2xl p-6 border border-[#E9EDEF] shadow-sm space-y-5">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-full bg-[#E7F7EF] text-[#00A884] flex items-center justify-center shrink-0">
              <Send className="w-5 h-5 -rotate-45 ml-0.5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#111B21]">
                REST Message Composer
              </h3>
              <p className="text-xs text-[#667781] mt-0.5">
                Paced queue delivery with human typing simulation & anti-ban protection.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Session select */}
            <div>
              <label className="block text-xs font-semibold text-[#111B21] mb-1.5">
                Source WhatsApp Session
              </label>
              <select
                value={selectedSession}
                onChange={(e) => setSelectedSession(e.target.value)}
                required
                className="w-full bg-white border border-[#D1D7DB] rounded-xl px-3.5 py-2.5 text-xs text-[#111B21] focus:outline-none focus:border-[#00A884] focus:ring-1 focus:ring-[#00A884] transition"
              >
                {sessions.length === 0 ? (
                  <option value="">No sessions available</option>
                ) : (
                  sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.phoneNumber ? `+${s.phoneNumber}` : s.id})
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Recipient */}
            <div>
              <label className="block text-xs font-semibold text-[#111B21] mb-1.5">
                Recipient Phone Number / Chat JID
              </label>
              <input
                type="text"
                required
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="e.g. 919547522702"
                className="w-full bg-white border border-[#D1D7DB] rounded-xl px-3.5 py-2.5 text-xs font-mono text-[#111B21] focus:outline-none focus:border-[#00A884] focus:ring-1 focus:ring-[#00A884] transition"
              />
              <span className="text-[11px] text-[#667781] mt-1.5 block">
                Auto-normalizes 10-digit Indian numbers and routes active LID chats.
              </span>
            </div>

            {/* Message Type */}
            <div>
              <label className="block text-xs font-semibold text-[#111B21] mb-1.5">
                Message Format
              </label>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { id: 'text', label: 'Text', icon: MessageSquare },
                  { id: 'image', label: 'Image', icon: ImageIcon },
                  { id: 'document', label: 'Document', icon: FileText },
                  { id: 'voice', label: 'Voice PTT', icon: Mic },
                ].map((item) => {
                  const Icon = item.icon;
                  const isSelected = msgType === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setMsgType(item.id as any)}
                      className={`py-2.5 px-2 rounded-xl border text-xs font-medium flex flex-col items-center gap-1.5 transition ${
                        isSelected
                          ? 'bg-[#E7F7EF]/60 border-[#00A884] text-[#008069] shadow-xs'
                          : 'bg-white border-[#E9EDEF] text-[#54656F] hover:bg-[#F5F6F6] hover:text-[#111B21]'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Media URL (if applicable) */}
            {msgType !== 'text' && (
              <div>
                <label className="block text-xs font-semibold text-[#111B21] mb-1.5">
                  Media File URL (AWS S3 or Cloud Storage)
                </label>
                <input
                  type="url"
                  required
                  value={mediaUrl}
                  onChange={(e) => setMediaUrl(e.target.value)}
                  placeholder="https://klz-api-gateway-s3-storage.../image.jpg"
                  className="w-full bg-white border border-[#D1D7DB] rounded-xl px-3.5 py-2.5 text-xs text-[#111B21] focus:outline-none focus:border-[#00A884] focus:ring-1 focus:ring-[#00A884] transition"
                />
              </div>
            )}

            {/* Content / Caption */}
            <div>
              <label className="block text-xs font-semibold text-[#111B21] mb-1.5">
                {msgType === 'text' ? 'Message Content' : 'Caption (Optional)'}
              </label>
              <textarea
                rows={3}
                required={msgType === 'text'}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Type your message here..."
                maxLength={4096}
                className="w-full bg-white border border-[#D1D7DB] rounded-xl p-3 text-xs text-[#111B21] placeholder:text-[#8696A0] focus:outline-none focus:border-[#00A884] focus:ring-1 focus:ring-[#00A884] transition resize-none"
              />
              <div className="text-[11px] text-[#8696A0] text-right mt-1 font-mono">
                {content.length} / 4096
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={sending || sessions.length === 0}
              className="w-full py-3 bg-[#008069] hover:bg-[#00705B] text-white font-medium rounded-xl text-sm shadow-sm transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {sending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Pacing & Enqueuing...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Enqueue Message (202 Accepted)</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Real-Time Live Feed / Conversation Stream */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-[#E9EDEF] shadow-sm flex flex-col h-[650px] overflow-hidden">
          {/* Header */}
          <div className="bg-white px-5 py-3 border-b border-[#E9EDEF] flex items-center justify-between shrink-0">
            <div>
              {activeChat ? (
                <div className="flex items-center gap-3">
                  <button
                    onClick={onCloseChat}
                    className="p-1 rounded-lg text-[#54656F] hover:text-[#111B21] hover:bg-[#F5F6F6] transition"
                    title="Back to all conversations"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <div className="w-10 h-10 rounded-full bg-[#DFE5E7] text-[#54656F] font-semibold text-sm flex items-center justify-center shrink-0">
                    {getInitials(activeChat.displayName, activeChat.chatJid)}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[#111B21] flex items-center gap-2">
                      <span className="truncate max-w-[200px] sm:max-w-[280px]">
                        {activeChat.displayName || activeChat.chatJid}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] bg-[#E7F7EF] text-[#008069] font-medium px-2 py-0.5 rounded-full border border-[#C3ECD7]">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#00A884]"></span>
                        Active Chat
                      </span>
                    </h3>
                    <p className="text-xs text-[#667781] mt-0.5">
                      AWS S3 Media & Chat History
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-[#E7F7EF] text-[#00A884] flex items-center justify-center">
                    <MessageSquare className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[#111B21]">
                      Real-Time Conversation Stream
                    </h3>
                    <p className="text-xs text-[#667781]">
                      Click any conversation to view full chat history with media
                    </p>
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onRefreshFeed}
                disabled={feedLoading}
                className="flex items-center gap-1.5 text-xs text-[#54656F] hover:text-[#111B21] bg-white hover:bg-[#F5F6F6] border border-[#D1D7DB] px-3 py-1.5 rounded-xl font-medium transition shadow-xs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${feedLoading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
              <button
                className="text-[#54656F] hover:text-[#111B21] p-1.5 rounded-lg hover:bg-[#F5F6F6] transition"
                title="Options"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Message List or Chat Feed */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 wa-chat-bg">
            {activeChat ? (
              conversationLoading && conversationMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-xs text-[#667781] space-y-2">
                  <Loader2 className="w-6 h-6 animate-spin text-[#00A884]" />
                  <span>Loading full chat history...</span>
                </div>
              ) : conversationMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-xs text-[#667781] space-y-1">
                  <MessageSquare className="w-6 h-6 text-[#8696A0]" />
                  <span>No messages in this conversation yet.</span>
                </div>
              ) : (
                <>
                  {/* Today date pill */}
                  <div className="flex justify-center my-2">
                    <span className="bg-white/95 text-[#54656F] text-[11px] font-medium px-3 py-1 rounded-md shadow-xs border border-[#E9EDEF]">
                      Today
                    </span>
                  </div>

                  {conversationMessages.map((message) => {
                    const isOutbound = message.direction === 'outbound';
                    const hasImage = isImageMedia(message);
                    const hasVoice = isVoiceMedia(message);
                    const resolvedMedia = resolveMediaUrl(message.mediaUrl);
                    const timeStr = formatChatTime(message.createdAt);

                    return (
                      <div
                        key={message.id}
                        className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[75%] rounded-2xl p-3 shadow-xs space-y-1.5 transition ${
                            isOutbound
                              ? 'bg-[#D9FDD3] text-[#111B21] rounded-tr-sm border border-emerald-900/5'
                              : 'bg-white text-[#111B21] rounded-tl-sm border border-black/5'
                          }`}
                        >
                          {/* 1. Image Media Component */}
                          {hasImage && resolvedMedia && (
                            <div className="space-y-1.5">
                              <div className="relative group overflow-hidden rounded-xl border border-black/10 bg-black/5">
                                <img
                                  src={resolvedMedia}
                                  alt={message.content || 'Shared image'}
                                  className="w-full max-h-64 object-cover cursor-pointer group-hover:scale-[1.01] transition duration-200"
                                  onClick={() => setSelectedLightboxImage(resolvedMedia)}
                                  loading="lazy"
                                />
                                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2 pointer-events-none">
                                  <span className="bg-black/70 text-white text-[11px] font-medium px-2.5 py-1 rounded-full flex items-center gap-1 shadow">
                                    <Maximize2 className="w-3 h-3" />
                                    <span>Zoom</span>
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center justify-between text-[10px] text-[#667781] px-1">
                                <span className="flex items-center gap-1 text-[#008069] font-medium">
                                  <ImageIcon className="w-3 h-3" />
                                  <span>{isOutbound ? 'AI Generated Image' : 'Customer Photo'}</span>
                                </span>
                                <a
                                  href={resolvedMedia}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hover:text-[#111B21] flex items-center gap-1 underline underline-offset-2"
                                >
                                  <Download className="w-2.5 h-2.5" />
                                  <span>Download</span>
                                </a>
                              </div>
                            </div>
                          )}

                          {/* 2. Voice Note Component */}
                          {hasVoice && (
                            <div className="space-y-2 bg-black/5 p-2.5 rounded-xl border border-black/5">
                              <div className="flex items-center justify-between text-[11px] text-[#008069] font-semibold">
                                <span className="flex items-center gap-1.5">
                                  <Mic className="w-3.5 h-3.5 animate-pulse text-[#00A884]" />
                                  <span>Voice Note Audio</span>
                                </span>
                                {resolvedMedia && (
                                  <a
                                    href={resolvedMedia}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[10px] text-[#667781] hover:text-[#111B21] flex items-center gap-1"
                                  >
                                    <Download className="w-2.5 h-2.5" />
                                    <span>Audio</span>
                                  </a>
                                )}
                              </div>

                              {resolvedMedia ? (
                                <audio
                                  controls
                                  preload="metadata"
                                  className="w-full h-8 rounded-lg accent-[#008069]"
                                  src={resolvedMedia}
                                >
                                  Your browser does not support audio playback.
                                </audio>
                              ) : (
                                <div className="text-[10px] text-[#667781] italic">
                                  Audio file recorded
                                </div>
                              )}

                              {/* Voice Transcription Display */}
                              {message.content && (
                                <div className="text-[11px] text-[#111B21] bg-white p-2 rounded-lg border border-[#E9EDEF] space-y-0.5">
                                  <span className="text-[10px] font-semibold text-[#008069] uppercase tracking-wider block">
                                    Transcript
                                  </span>
                                  <p className="italic whitespace-pre-wrap leading-relaxed">
                                    "{message.content}"
                                  </p>
                                </div>
                              )}
                            </div>
                          )}

                          {/* 3. Document Component */}
                          {message.type === 'document' && resolvedMedia && (
                            <a
                              href={resolvedMedia}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2.5 p-2.5 bg-white rounded-xl border border-[#E9EDEF] hover:border-[#00A884] transition group"
                            >
                              <div className="p-2 rounded-lg bg-[#E7F7EF] text-[#008069]">
                                <FileText className="w-4 h-4" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-[#111B21] truncate">
                                  {message.content || 'Document attachment'}
                                </p>
                                <span className="text-[10px] text-[#667781]">Click to download file</span>
                              </div>
                              <Download className="w-3.5 h-3.5 text-[#667781] group-hover:text-[#008069]" />
                            </a>
                          )}

                          {/* 4. Text Content (for non-voice or captions) */}
                          {!hasVoice && message.content && (
                            <p className="text-xs text-[#111B21] whitespace-pre-wrap break-words leading-relaxed">
                              {message.content}
                            </p>
                          )}

                          {/* Fallback if no content and no media */}
                          {!hasVoice && !hasImage && message.type !== 'document' && !message.content && (
                            <p className="text-xs text-[#667781] italic">
                              {message.type || 'Media message'}
                            </p>
                          )}

                          {/* Message Footer metadata with timestamp and ticks */}
                          <div className="flex items-center justify-end gap-1.5 text-[10px] text-[#667781] pt-0.5">
                            <span>{timeStr}</span>
                            {isOutbound && (
                              <CheckCheck className="w-3.5 h-3.5 text-[#53BDEB]" />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messageListEndRef} />
                </>
              )
            ) : messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-[#667781] space-y-2 text-center p-6">
                <MessageSquare className="w-8 h-8 text-[#8696A0]" />
                <p className="text-xs font-medium text-[#111B21]">No conversations recorded yet.</p>
                <p className="text-[11px] text-[#667781]">
                  Send a message from the composer or to your WhatsApp number to start chatting.
                </p>
              </div>
            ) : (
              messages.map((m, idx) => (
                <div
                  key={`${m.chatJid}-${idx}`}
                  onClick={() => handleSelectChat(m)}
                  className="p-3 bg-white hover:bg-[#F5F6F6] rounded-xl border border-[#E9EDEF] shadow-xs flex items-center gap-3 transition cursor-pointer group"
                  title="Click to view conversation and reply"
                >
                  <div className="w-10 h-10 rounded-full bg-[#DFE5E7] text-[#54656F] font-semibold text-xs flex items-center justify-center shrink-0">
                    {getInitials(m.displayName, m.chatJid)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="font-semibold text-[#111B21] group-hover:text-[#008069] truncate">
                        {m.displayName || m.chatJid}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-[#8696A0] shrink-0 font-mono">
                        <Clock className="w-3 h-3 text-[#8696A0]" />
                        <span>{formatChatTime(m.lastTimestamp)}</span>
                      </span>
                    </div>
                    <div className="text-xs text-[#667781] truncate">
                      {m.lastMessage || (
                        <span className="italic text-[#8696A0] flex items-center gap-1">
                          <Mic className="w-3 h-3 text-[#00A884] inline" />
                          Voice Note / Media
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Quick-reply footer when an active conversation is open */}
          {activeChat && (
            <div className="bg-[#F0F2F5] px-4 py-3 border-t border-[#E9EDEF] flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                className="text-[#54656F] hover:text-[#111B21] p-1.5 hover:bg-white rounded-full transition"
                title="Emojis"
              >
                <Smile className="w-5 h-5" />
              </button>
              <input
                type="text"
                placeholder={`Reply to ${activeChat.displayName || activeChat.chatJid}...`}
                value={quickReplyText}
                onChange={(e) => setQuickReplyText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleQuickSend();
                  }
                }}
                disabled={quickSending}
                className="flex-1 bg-white border border-[#E9EDEF] rounded-full px-4 py-2 text-xs text-[#111B21] placeholder-[#8696A0] focus:outline-none focus:border-[#00A884] shadow-xs transition"
              />
              <button
                type="button"
                className="text-[#54656F] hover:text-[#111B21] p-1.5 hover:bg-white rounded-full transition"
                title="Attach file"
              >
                <Paperclip className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={handleQuickSend}
                disabled={quickSending || !quickReplyText.trim()}
                className="bg-[#008069] hover:bg-[#00705B] disabled:opacity-40 text-white font-medium px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition shrink-0 shadow-xs"
              >
                {quickSending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span>Send</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
