/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, ReactNode, ChangeEvent } from 'react';
import { 
  Database, 
  MessageSquare, 
  Settings, 
  Plus, 
  Bell, 
  User, 
  Sparkles, 
  Send, 
  UploadCloud, 
  History, 
  Copy, 
  Check,
  Search,
  FileText,
  ChevronRight,
  ShieldCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Backend API URL. Override by setting VITE_API_URL in a .env file at the Frontend/ root.
// Default points at a locally running FastAPI server (uvicorn Backend.main:app --port 8000).
const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000';

// Tiny helper: format the current wall-clock time as HH:MM (e.g. "14:23") for chat timestamps.
function nowHHMM() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Tiny helper: turn raw byte counts into a friendly "12.4 MB" / "451 KB" string for the sources panel.
function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Types
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  code?: string;
  timestamp: string;
}

interface Source {
  id: string;
  name: string;
  type: string;
  size: string;
  isMain?: boolean;
}

export default function App() {
  const [query, setQuery] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  // Real state — populated from real backend interactions, no more mock data.
  // `sources` grows as the user uploads documents via POST /ingest.
  // `chatMessages` grows as the user sends queries via POST /query.
  const [sources, setSources] = useState<Source[]>([]);
  const [chatMessages, setChatMessages] = useState<Message[]>([]);

  // Request-in-flight flags so we can disable buttons and show a "thinking" indicator.
  const [isSending, setIsSending] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  // Most recent network error (e.g. backend not running). Shown above the input.
  const [error, setError] = useState<string | null>(null);

  // Hidden <input type="file"> reference — the styled "ADD DOCUMENT" button triggers it.
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Send the user's question to the backend's /query endpoint and append the answer to the chat.
  const handleSend = async () => {
    const trimmed = query.trim();
    if (!trimmed || isSending) return;

    // 1. Optimistically render the user's message so the UI feels instant.
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: trimmed,
      timestamp: nowHHMM(),
    };
    setChatMessages(prev => [...prev, userMessage]);
    setQuery('');
    setIsSending(true);
    setError(null);

    // 2. Call FastAPI. Expected contract: POST /query { query } -> { answer, sources? }.
    try {
      const res = await fetch(`${API_URL}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
      });
      if (!res.ok) throw new Error(`Backend returned ${res.status}`);
      const data = (await res.json()) as { answer?: string; sources?: string[] };

      // 3. Append the assistant's reply.
      const assistantMessage: Message = {
        id: `${Date.now()}-a`,
        role: 'assistant',
        content: data.answer ?? '(backend returned no answer)',
        sources: data.sources,
        timestamp: nowHHMM(),
      };
      setChatMessages(prev => [...prev, assistantMessage]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setError(`Query failed: ${msg}. Is the FastAPI backend running at ${API_URL}?`);
    } finally {
      setIsSending(false);
    }
  };

  // Upload the picked file to the backend's /ingest endpoint as multipart/form-data.
  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input value so re-picking the same file still fires onChange next time.
    e.target.value = '';
    if (!file) return;

    setIsUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API_URL}/ingest`, { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`Backend returned ${res.status}`);
      const data = (await res.json()) as { filename?: string; chunks?: number };

      // Add the freshly ingested file to the right-side "Sources in Use" panel.
      // The first uploaded source is highlighted with the cyan accent bar.
      const newSource: Source = {
        id: Date.now().toString(),
        name: data.filename ?? file.name,
        type: file.type || 'Document',
        size: formatBytes(file.size),
        isMain: sources.length === 0,
      };
      setSources(prev => [...prev, newSource]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Upload failed: ${msg}. Is the FastAPI backend running at ${API_URL}?`);
    } finally {
      setIsUploading(false);
    }
  };


  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-brand-bg text-on-surface font-sans">
      {/* Sidebar */}
      <AnimatePresence mode="wait">
        {isSidebarOpen && (
          <motion.nav 
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 256, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="flex flex-col border-r border-white/10 bg-brand-surface h-full"
          >
            <div className="p-6">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded bg-brand-cyan/20 flex items-center justify-center border border-brand-cyan/30">
                  <Database className="w-5 h-5 text-brand-cyan" />
                </div>
                <div>
                  <h1 className="text-xl font-display font-bold text-brand-cyan tracking-tight leading-none">ArchAI</h1>
                  <span className="text-[10px] font-mono text-on-surface-variant opacity-60">V1.0.42-STABLE</span>
                </div>
              </div>

              <button className="mt-8 w-full group relative flex items-center justify-center gap-2 py-3 px-4 bg-brand-cyan text-brand-bg font-bold rounded-lg overflow-hidden transition-all hover:scale-[1.02] active:scale-95 glow-cyan">
                <Plus className="w-4 h-4" />
                <span>New Session</span>
                <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500" />
              </button>
            </div>

            <div className="flex-1 px-3 space-y-1">
              <SidebarItem icon={<MessageSquare size={18} />} label="Chat" active />
              <SidebarItem icon={<Database size={18} />} label="Knowledge Base" />
              <SidebarItem icon={<Settings size={18} />} label="Settings" />
            </div>

            <div className="p-4 border-t border-white/5 bg-black/20">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-brand-cyan/10 border border-brand-cyan/20 flex items-center justify-center overflow-hidden">
                  <img 
                    src="https://api.dicebear.com/7.x/avataaars/svg?seed=Alex" 
                    alt="User" 
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">Alex Rivera</p>
                  <p className="text-[10px] font-mono text-on-surface-variant opacity-60 uppercase tracking-wider">Lead Architect</p>
                </div>
              </div>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative h-full min-w-0">
        {/* Header */}
        <header className="h-16 flex items-center justify-between px-6 border-b border-white/10 glass-panel sticky top-0 z-10">
          <div className="flex items-center gap-4">
            {!isSidebarOpen && (
              <button 
                onClick={() => setIsSidebarOpen(true)}
                className="p-2 hover:bg-white/5 rounded-lg transition-colors cursor-pointer"
              >
                <div className="flex flex-col gap-1 w-5">
                  <span className="w-full h-0.5 bg-brand-cyan" />
                  <span className="w-2/3 h-0.5 bg-brand-cyan" />
                </div>
              </button>
            )}
            <h2 className="text-lg font-semibold text-brand-cyan tracking-tight">RAG Command Center</h2>
            <div className="flex items-center gap-2 px-3 py-1 bg-brand-cyan/5 border border-brand-cyan/20 rounded-full h-fit">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-cyan animate-pulse" />
              <span className="text-[10px] font-mono text-brand-cyan font-bold uppercase tracking-widest">System: Online</span>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <HeaderAction icon={<Search size={20} />} />
            <HeaderAction icon={<Bell size={20} />} />
            <HeaderAction icon={<Settings size={20} />} />
          </div>
        </header>

        {/* Chat Scroll Container */}
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto custom-scrollbar px-4 py-8 md:px-12 lg:px-24 scroll-smooth"
        >
          <div className="max-w-4xl mx-auto space-y-12">
            {chatMessages.map((msg) => (

              <motion.div 
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="group"
              >
                {/* Message Header */}
                <div className="flex items-center gap-2 mb-4">
                  {msg.role === 'user' ? (
                    <>
                      <User size={14} className="text-on-surface-variant" />
                      <span className="text-[11px] font-mono font-bold text-on-surface-variant uppercase tracking-widest">YOU</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={14} className="text-brand-cyan" />
                      <span className="text-[11px] font-mono font-bold text-brand-cyan uppercase tracking-widest">ARCHAI ENGINE</span>
                    </>
                  )}
                  <div className="h-[1px] flex-1 bg-white/5" />
                  <span className="text-[10px] font-mono text-on-surface-variant opacity-40">{msg.timestamp}</span>
                </div>

                {/* Message Content */}
                <div className={`pl-4 border-l-2 ${msg.role === 'user' ? 'border-white/5' : 'border-brand-cyan/30'}`}>
                  <div className="prose prose-invert max-w-none text-on-surface/90 leading-relaxed">
                    {msg.content.split('\n').map((line, i) => (
                      <p key={i} className="mb-4 last:mb-0">
                        {line.split(/(\[\d+\])/).map((part, j) => {
                          if (part.match(/\[\d+\]/)) {
                            return (
                              <span key={j} className="inline-flex items-center px-1.5 py-0.5 mx-0.5 bg-brand-cyan/10 border border-brand-cyan/20 rounded text-[10px] font-mono text-brand-cyan cursor-pointer hover:bg-brand-cyan/20 transition-colors">
                                {part}
                              </span>
                            );
                          }
                          return part;
                        })}
                      </p>
                    ))}
                  </div>

                  {/* Code Block */}
                  {msg.code && (
                    <div className="mt-6 rounded-xl overflow-hidden glass-panel border border-white/5">
                      <div className="flex items-center justify-between px-4 py-2 bg-black/40 border-b border-white/5">
                        <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">latency_analysis.py</span>
                        <button 
                          onClick={() => handleCopy(msg.code!)}
                          className="flex items-center gap-1.5 text-[10px] font-mono text-on-surface-variant hover:text-brand-cyan transition-colors"
                        >
                          {copied ? <Check size={12} /> : <Copy size={12} />}
                          {copied ? 'COPIED' : 'COPY'}
                        </button>
                      </div>
                      <pre className="p-5 overflow-x-auto text-sm font-mono text-brand-cyan/80 bg-brand-bg/50">
                        <code>{msg.code}</code>
                      </pre>
                    </div>
                  )}

                  {/* Source Tags */}
                  {msg.sources && (
                    <div className="flex flex-wrap gap-2 mt-6">
                      {msg.sources.map((src, i) => (
                        <div key={i} className="flex items-center gap-2 px-3 py-1.5 glass-panel rounded-full text-[10px] font-mono hover:border-brand-cyan/30 cursor-pointer transition-all">
                          <div className="w-4 h-4 rounded-full bg-brand-cyan/20 flex items-center justify-center text-[8px] text-brand-cyan">{i+1}</div>
                          <span className="text-on-surface-variant">{src}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            ))}

            {/* Thinking Indicator — only visible while a /query request is in flight. */}
            {isSending && (
              <div className="flex items-center gap-4 py-4 opacity-80 transition-opacity">
                <div className="h-px flex-1 bg-white/5" />
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-cyan animate-pulse" />
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest">AI IS PROCESSING RELATED DOCUMENTS</span>
                </div>
                <div className="h-px flex-1 bg-white/5" />
              </div>
            )}

            {/* Empty-state hint shown before the user has chatted or uploaded anything. */}
            {chatMessages.length === 0 && !isSending && (
              <div className="text-center py-12 opacity-60">
                <p className="text-sm font-mono uppercase tracking-widest text-brand-cyan">No conversation yet</p>
                <p className="text-xs mt-2 text-on-surface-variant">Upload a document with "ADD DOCUMENT" below, then ask a question.</p>
              </div>
            )}
          </div>
        </div>

        {/* Floating Input Area */}
        <div className="px-6 pb-6 pt-2 bg-gradient-to-t from-brand-bg via-brand-bg/80 to-transparent sticky bottom-0">
          <div className="max-w-4xl mx-auto">
            {/* Error banner — shown if either /query or /ingest fails. Click to dismiss. */}
            {error && (
              <button
                onClick={() => setError(null)}
                className="w-full mb-3 text-left px-4 py-2 rounded-lg border border-red-500/40 bg-red-500/10 text-[11px] font-mono text-red-300 hover:bg-red-500/20 transition-colors"
              >
                {error} <span className="opacity-60">(click to dismiss)</span>
              </button>
            )}

            {/* Hidden file picker — clicking the styled "ADD DOCUMENT" button below opens this. */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.json,.doc,.docx,.md"
              onChange={handleFileSelect}
              className="hidden"
            />

            <div className="glass-overlay rounded-2xl p-2 transition-all focus-within:ring-1 focus-within:ring-brand-cyan/30">
              <div className="flex items-end gap-2 px-2 py-2">
                <textarea
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Type your query to the knowledge base..."
                  className="w-full bg-transparent border-none focus:ring-0 text-base resize-none py-2 max-h-48 custom-scrollbar placeholder:text-on-surface-variant/30"
                  rows={1}
                  disabled={isSending}
                />
                <div className="flex items-center gap-1 pb-1">
                  <div className="w-px h-6 bg-white/10 mx-1" />
                  <button
                    onClick={handleSend}
                    disabled={!query.trim() || isSending}
                    className="h-10 w-10 flex items-center justify-center bg-brand-cyan text-brand-bg rounded-xl glow-cyan hover:scale-105 active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Send size={18} strokeWidth={2.5} />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between p-2 pt-0">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-dashed border-white/20 rounded-lg text-[10px] font-mono text-on-surface-variant hover:bg-white/10 hover:border-brand-cyan/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <UploadCloud size={14} />
                    <span>{isUploading ? 'UPLOADING...' : 'ADD DOCUMENT'}</span>
                  </button>
                  <span className="text-[9px] font-mono text-on-surface-variant/40 uppercase tracking-tighter">MAX 50MB (PDF, TXT, JSON, DOCX)</span>
                </div>

                <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono text-on-surface-variant/60">
                  <History size={14} />
                  <span>GPT-4O + RAG-V2</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Right Panels (Active Context) */}
      <aside className="hidden lg:flex flex-col w-80 bg-brand-surface border-l border-white/10 h-full">
        <div className="p-5 border-b border-white/10">
          <h3 className="text-[11px] font-display font-bold text-brand-cyan uppercase tracking-[0.2em] mb-1">Active Context</h3>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-8 custom-scrollbar">
          {/* Sources Section */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-mono font-bold text-on-surface-variant opacity-50 uppercase tracking-widest">Sources in Use</span>
              <span className="text-[10px] font-mono text-brand-cyan">{sources.length} Total</span>
            </div>
            <div className="space-y-3">
              {sources.map(src => (
                <div key={src.id} className={`group p-3 rounded-lg glass-panel transition-all hover:border-brand-cyan/40 cursor-pointer ${src.isMain ? 'border-l-2 border-l-brand-cyan' : 'border-l-2 border-l-brand-cyan/20'}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate group-hover:text-brand-cyan transition-colors">{src.name}</p>
                      <p className="text-[10px] font-mono opacity-50 mt-1">{src.type} • {src.size}</p>
                    </div>
                    <ChevronRight size={14} className="text-on-surface-variant opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0" />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Visualization Section */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-mono font-bold text-on-surface-variant opacity-50 uppercase tracking-widest">Knowledge Graph</span>
            </div>
            <div className="relative aspect-square rounded-2xl glass-panel overflow-hidden group cursor-crosshair">
              <img 
                src="https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?auto=format&fit=crop&q=80&w=800" 
                alt="Visualization"
                className="w-full h-full object-cover opacity-60 group-hover:scale-110 transition-transform duration-1000 grayscale group-hover:grayscale-0"
              />
              <div className="absolute inset-0 bg-brand-bg/40 flex flex-col justify-end p-4">
                <div className="flex items-center gap-1.5 text-brand-cyan mb-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-brand-cyan animate-pulse" />
                  <span className="text-[10px] font-display font-bold uppercase tracking-widest">Live Analysis</span>
                </div>
                <p className="text-[11px] text-on-surface-variant leading-tight">Cluster analysis of retrieved snippets in high-dimensional vector space.</p>
              </div>
            </div>
          </section>

          {/* Verification Section */}
          <section>
            <div className="p-4 rounded-xl glass-panel bg-brand-cyan/5 border-dashed space-y-3">
              <div className="flex items-center gap-2 text-brand-cyan">
                <ShieldCheck size={16} />
                <span className="text-[10px] font-display font-bold uppercase tracking-widest">Verification Passed</span>
              </div>
              <p className="text-[11px] text-on-surface-variant italic leading-relaxed">
                "...the hierarchical structure of HNSW allows for logarithmic search complexity by traversing layers of decreasing density..."
              </p>
            </div>
          </section>
        </div>

        {/* Footer Statistics */}
        <div className="p-5 border-t border-white/5 bg-black/20">
          <div className="flex items-center justify-between text-[10px] font-mono mb-2">
            <span className="text-on-surface-variant">TOKEN USAGE</span>
            <span className="text-brand-cyan">1.2k / 128k</span>
          </div>
          <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: '15%' }}
              className="h-full bg-brand-cyan glow-cyan"
            />
          </div>
        </div>
      </aside>
    </div>
  );
}

// Sub-components
function SidebarItem({ icon, label, active = false }: { icon: ReactNode, label: string, active?: boolean }) {
  return (
    <div className={`
      flex items-center gap-3 px-4 py-2.5 rounded-lg cursor-pointer transition-all
      ${active ? 'bg-brand-cyan/10 text-brand-cyan border-r-2 border-brand-cyan' : 'text-on-surface-variant hover:bg-white/5 hover:text-on-surface'}
    `}>
      {icon}
      <span className="text-sm font-medium">{label}</span>
      {active && <div className="ml-auto w-1 h-1 rounded-full bg-brand-cyan" />}
    </div>
  );
}

function HeaderAction({ icon }: { icon: ReactNode }) {
  return (
    <button className="p-2 text-on-surface-variant hover:text-brand-cyan hover:bg-brand-cyan/5 rounded-lg transition-all">
      {icon}
    </button>
  );
}

function InputTool({ icon }: { icon: ReactNode }) {
  return (
    <button className="p-2 text-on-surface-variant hover:text-brand-cyan hover:bg-white/5 rounded-lg transition-all cursor-pointer">
      {icon}
    </button>
  );
}

function FeatureCard({ title, content }: { title: string, content: string }) {
  return (
    <div className="p-4 rounded-xl glass-panel border border-white/5">
      <h4 className="text-[10px] font-display font-bold text-brand-cyan mb-2 uppercase tracking-widest">{title}</h4>
      <p className="text-sm text-on-surface-variant leading-relaxed">{content}</p>
    </div>
  );
}
