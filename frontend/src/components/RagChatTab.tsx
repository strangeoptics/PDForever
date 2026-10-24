import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bot,
  AlertCircle,
  Copy,
  Check,
  ChevronDown,
  ExternalLink,
  BookOpen,
  Loader2,
  X,
  Send,
} from 'lucide-react';
import { api } from '../api';
import {
  DocumentFilterParams,
  DocumentItem,
  OllamaStatus,
  RagPassage,
  RagQueryPayload,
  formatDocTitle,
} from '../types';

export interface RagChatTabProps {
  activeDoc: DocumentItem | null;
  currentFilterParams: DocumentFilterParams;
  customOllamaUrl?: string;
  ragModel?: string;
  selectedFolderPath?: string;
  selectedTagName?: string;
  onNavigateToDocument: (documentId: string, pageNumber: number) => void;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  passages?: RagPassage[];
  timestamp: number;
  error?: boolean;
}

export const RagChatTab: React.FC<RagChatTabProps> = React.memo(({
  activeDoc,
  currentFilterParams,
  customOllamaUrl,
  ragModel = 'qwen2.5:14b',
  selectedFolderPath,
  selectedTagName,
  onNavigateToDocument,
}) => {
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [ragScope, setRagScope] = useState<'current' | 'library'>(activeDoc ? 'current' : 'library');
  const [ragQuery, setRagQuery] = useState<string>('');
  const [ragLoading, setRagLoading] = useState<boolean>(false);
  const [ragStreamingText, setRagStreamingText] = useState<string>('');
  const [ragStreamingPassages, setRagStreamingPassages] = useState<RagPassage[]>([]);
  const [ragMessages, setRagMessages] = useState<ChatMessage[]>([]);
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});
  const [ragCopiedCmd, setRagCopiedCmd] = useState<boolean>(false);

  const ragAbortControllerRef = useRef<AbortController | null>(null);
  const ragMessagesEndRef = useRef<HTMLDivElement | null>(null);

  // Load Ollama status on mount or config change
  useEffect(() => {
    api
      .getRagStatus(customOllamaUrl)
      .then(setOllamaStatus)
      .catch(() => {
        setOllamaStatus({
          enabled: true,
          available: false,
          ollamaUrl: customOllamaUrl || 'http://localhost:11434',
          currentModel: ragModel,
          installedModels: [],
          message: 'Ollama ist offline oder nicht erreichbar.',
        });
      });
  }, [customOllamaUrl, ragModel]);

  // Adjust default scope when activeDoc changes
  useEffect(() => {
    if (!activeDoc && ragScope === 'current') {
      setRagScope('library');
    }
  }, [activeDoc, ragScope]);

  // Auto-scroll on new messages or streaming
  useEffect(() => {
    ragMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [ragMessages, ragStreamingText]);

  const handleSendRagQuery = useCallback(
    (promptText?: string) => {
      const q = (promptText ?? ragQuery).trim();
      if (!q || ragLoading) return;

      const userMsgId = 'user-' + Date.now();
      const assistantMsgId = 'asst-' + (Date.now() + 1);

      setRagMessages((prev) => [
        ...prev,
        {
          id: userMsgId,
          role: 'user',
          text: q,
          timestamp: Date.now(),
        },
      ]);
      setRagQuery('');
      setRagLoading(true);
      setRagStreamingText('');
      setRagStreamingPassages([]);

      const abortController = new AbortController();
      ragAbortControllerRef.current = abortController;

      let accumulatedText = '';
      let collectedPassages: RagPassage[] = [];

      const payload: RagQueryPayload = {
        query: q,
        model: ragModel,
      };

      if (ragScope === 'current' && activeDoc) {
        payload.documentId = activeDoc.id;
      } else {
        payload.criteria = currentFilterParams;
      }

      api.streamRag(
        payload,
        (passages) => {
          collectedPassages = passages;
          setRagStreamingPassages(passages);
        },
        (token) => {
          accumulatedText += token;
          setRagStreamingText(accumulatedText);
        },
        (error) => {
          setRagMessages((prev) => [
            ...prev,
            {
              id: assistantMsgId,
              role: 'assistant',
              text: accumulatedText.trim()
                ? accumulatedText
                : `Hinweis: ${error}\n\nDie relevanten Suchpassagen aus deinen PDF-Dokumenten wurden oben dennoch ermittelt.`,
              passages: collectedPassages,
              timestamp: Date.now(),
              error: true,
            },
          ]);
        },
        () => {
          setRagLoading(false);
          setRagStreamingText('');
          setRagStreamingPassages([]);
          ragAbortControllerRef.current = null;
          if (accumulatedText.trim()) {
            setRagMessages((prev) => {
              if (prev.some((m) => m.id === assistantMsgId)) return prev;
              return [
                ...prev,
                {
                  id: assistantMsgId,
                  role: 'assistant',
                  text: accumulatedText,
                  passages: collectedPassages,
                  timestamp: Date.now(),
                },
              ];
            });
          }
        },
        abortController.signal
      );
    },
    [ragQuery, ragLoading, ragScope, activeDoc, ragModel, currentFilterParams]
  );

  const handleStopRagStream = useCallback(() => {
    if (ragAbortControllerRef.current) {
      ragAbortControllerRef.current.abort();
      ragAbortControllerRef.current = null;
      setRagLoading(false);
    }
  }, []);

  const renderGroundedAnswer = useCallback(
    (text: string, passages?: RagPassage[]) => {
      const citationRegex = /\[(?:([^,\]]+),\s*)?S\.\s*(\d+)(?:-(\d+))?\]/g;
      const paragraphs = text.split(/\n\s*\n/);

      const renderInlineMarkdown = (chunk: string, keyPrefix: string): React.ReactNode => {
        const tokenRegex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
        const segments = chunk.split(tokenRegex);

        return segments.map((seg, idx) => {
          if (seg.startsWith('**') && seg.endsWith('**') && seg.length > 4) {
            return (
              <strong key={`${keyPrefix}-${idx}`} className="font-semibold text-slate-900 dark:text-white">
                {seg.slice(2, -2)}
              </strong>
            );
          }
          if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2) {
            return (
              <code
                key={`${keyPrefix}-${idx}`}
                className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-900 text-[11px] font-mono text-purple-600 dark:text-purple-300 border border-slate-200 dark:border-slate-700/60 break-all"
              >
                {seg.slice(1, -1)}
              </code>
            );
          }
          if (seg.startsWith('*') && seg.endsWith('*') && seg.length > 2) {
            return (
              <em key={`${keyPrefix}-${idx}`} className="italic">
                {seg.slice(1, -1)}
              </em>
            );
          }
          return seg;
        });
      };

      return paragraphs.map((para, pIdx) => {
        if (!para.trim()) return null;

        const parts: React.ReactNode[] = [];
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        citationRegex.lastIndex = 0;
        while ((match = citationRegex.exec(para)) !== null) {
          const matchStart = match.index;
          const matchEnd = match.index + match[0].length;
          if (matchStart > lastIndex) {
            parts.push(renderInlineMarkdown(para.substring(lastIndex, matchStart), `${pIdx}-${lastIndex}`));
          }

          const rawCitation = match[0];
          const citedDocTitle = match[1]?.trim();
          const pageNum = parseInt(match[2], 10);

          let targetDocId = activeDoc?.id;
          if (citedDocTitle && passages && passages.length > 0) {
            const matchLower = citedDocTitle.toLowerCase();
            const found = passages.find(
              (p) =>
                p.documentTitle.toLowerCase().includes(matchLower) ||
                matchLower.includes(p.documentTitle.toLowerCase())
            );
            if (found) {
              targetDocId = found.documentId;
            }
          } else if (!targetDocId && passages && passages.length > 0) {
            const found = passages.find((p) => p.pageNumber === pageNum) ?? passages[0];
            targetDocId = found.documentId;
          }

          parts.push(
            <button
              key={`cit-${pIdx}-${matchStart}`}
              type="button"
              onClick={() => {
                if (targetDocId) {
                  onNavigateToDocument(targetDocId, pageNum);
                }
              }}
              className="inline-flex items-center gap-1 mx-1 my-0.5 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-purple-500/15 hover:bg-purple-500/25 text-purple-700 dark:text-purple-300 border border-purple-500/30 transition shadow-2xs hover:scale-105 active:scale-95 cursor-pointer align-baseline shrink-0 max-w-full"
              title={`Öffne Dokument auf Seite ${pageNum}`}
            >
              <BookOpen className="w-3 h-3 shrink-0" />
              <span className="truncate">{rawCitation}</span>
            </button>
          );

          lastIndex = matchEnd;
        }

        if (lastIndex < para.length) {
          parts.push(renderInlineMarkdown(para.substring(lastIndex), `${pIdx}-${lastIndex}`));
        }

        return (
          <p key={`p-${pIdx}`} className="text-xs leading-relaxed text-slate-800 dark:text-slate-200">
            {parts}
          </p>
        );
      });
    },
    [activeDoc, onNavigateToDocument]
  );

  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-slate-50/30 dark:bg-slate-900/40">
      {/* Header / Scope switch */}
      <div className="p-2.5 border-b border-slate-200 dark:border-slate-800 space-y-2 bg-white dark:bg-slate-900 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Bot className="w-4 h-4 text-purple-500" />
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
              RAG-Assistent
            </span>
          </div>
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
              ollamaStatus?.available
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                ollamaStatus?.available ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            />
            {ollamaStatus?.available
              ? ollamaStatus.currentModel || ragModel
              : 'Ollama offline'}
          </span>
        </div>

        {/* Scope selector */}
        <div className="grid grid-cols-2 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-medium">
          <button
            type="button"
            onClick={() => setRagScope('current')}
            disabled={!activeDoc}
            className={`py-1 px-2 rounded-md transition truncate ${
              ragScope === 'current'
                ? 'bg-white dark:bg-slate-700 text-purple-600 dark:text-purple-300 shadow-2xs font-semibold'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 disabled:opacity-40'
            }`}
            title={
              activeDoc
                ? `Nur im geöffneten Dokument suchen: ${formatDocTitle(activeDoc)}`
                : 'Kein Dokument geöffnet'
            }
          >
            {activeDoc ? 'Aktuelles Dokument' : 'Dokument wählen'}
          </button>
          <button
            type="button"
            onClick={() => setRagScope('library')}
            className={`py-1 px-2 rounded-md transition truncate ${
              ragScope === 'library'
                ? 'bg-white dark:bg-slate-700 text-purple-600 dark:text-purple-300 shadow-2xs font-semibold'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
            title="Im gesamten (bzw. durch Filter eingeschränkten) Bibliotheksbestand suchen"
          >
            Bibliothek {selectedFolderPath || selectedTagName ? '(Gefiltert)' : ''}
          </button>
        </div>
      </div>

      {/* Offline Warning Banner if Ollama is not reachable */}
      {ollamaStatus && !ollamaStatus.available && (
        <div className="m-2 p-2.5 rounded-xl border border-amber-300/80 dark:border-amber-900/60 bg-amber-500/10 text-xs space-y-1.5 shrink-0">
          <div className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>Ollama offline (RAG optional)</span>
          </div>
          <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-normal">
            PDForever funktioniert vollkommen normal ohne Ollama. Starte für KI-Antworten in der Konsole:
          </p>
          <div className="flex items-center justify-between gap-1 bg-slate-900 text-slate-200 px-2 py-1 rounded font-mono text-[11px]">
            <span className="truncate">ollama run {ragModel}</span>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(`ollama run ${ragModel}`);
                setRagCopiedCmd(true);
                setTimeout(() => setRagCopiedCmd(false), 2000);
              }}
              className="p-0.5 hover:text-white transition shrink-0"
              title="Befehl kopieren"
            >
              {ragCopiedCmd ? (
                <Check className="w-3 h-3 text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Chat Message Scroll Area */}
      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-3 space-y-3">
        {ragMessages.length === 0 && !ragLoading ? (
          <div className="text-center py-6 px-3 space-y-3">
            <div className="w-10 h-10 rounded-2xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center mx-auto">
              <Bot className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                {ragScope === 'current' && activeDoc
                  ? `Frage zum Dokument stellen`
                  : 'Frage an die Bibliothek stellen'}
              </h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
                {ragScope === 'current' && activeDoc
                  ? `Recherchiert gezielt in „${formatDocTitle(activeDoc)}“ mit Belegstellen [S. X].`
                  : 'Recherchiert passgenau über Lucene-Passagen in deiner PDF-Sammlung.'}
              </p>
            </div>

            {/* Quick suggestion buttons */}
            <div className="flex flex-col gap-1.5 pt-2 text-left">
              <button
                type="button"
                onClick={() => handleSendRagQuery('Was sind die zentralen Kernaussagen und Thesen?')}
                className="text-[11px] p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-purple-400 bg-white dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 transition text-left"
              >
                💡 Was sind die zentralen Kernaussagen und Thesen?
              </button>
              <button
                type="button"
                onClick={() => handleSendRagQuery('Fasse den Inhalt prägnant in 3 Stichpunkten zusammen.')}
                className="text-[11px] p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-purple-400 bg-white dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 transition text-left"
              >
                📝 Fasse den Inhalt in 3 Stichpunkten zusammen.
              </button>
            </div>
          </div>
        ) : (
          ragMessages.map((msg) => (
            <div
              key={msg.id}
              className={`w-full min-w-0 flex flex-col space-y-1.5 ${
                msg.role === 'user' ? 'items-end' : 'items-start'
              }`}
            >
              {msg.role === 'user' ? (
                <div className="max-w-[85%] rounded-2xl rounded-br-xs bg-purple-600 text-white px-3 py-2 text-xs shadow-xs break-words [overflow-wrap:anywhere] whitespace-pre-wrap">
                  {msg.text}
                </div>
              ) : (
                <div className="w-full min-w-0 max-w-full rounded-2xl rounded-tl-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 shadow-xs space-y-2 overflow-hidden break-words [overflow-wrap:anywhere]">
                  <div className="flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-400 pb-1.5 border-b border-slate-100 dark:border-slate-700">
                    <span className="flex items-center gap-1 font-semibold text-purple-600 dark:text-purple-400">
                      <Bot className="w-3 h-3" />
                      Antwort
                    </span>
                    {msg.passages && msg.passages.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedSources((prev) => ({
                            ...prev,
                            [msg.id]: !prev[msg.id],
                          }))
                        }
                        className="flex items-center gap-1 hover:text-purple-500 transition cursor-pointer"
                      >
                        <span>{msg.passages.length} Quellen</span>
                        <ChevronDown
                          className={`w-3 h-3 transition-transform ${
                            expandedSources[msg.id] ? 'rotate-180' : ''
                          }`}
                        />
                      </button>
                    )}
                  </div>

                  {/* Grounded text with citations */}
                  <div className="space-y-2 min-w-0 max-w-full break-words [overflow-wrap:anywhere]">
                    {renderGroundedAnswer(msg.text, msg.passages)}
                  </div>

                  {/* Passages Accordion */}
                  {msg.passages && msg.passages.length > 0 && expandedSources[msg.id] && (
                    <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700 space-y-2 min-w-0">
                      <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-400 tracking-wider">
                        Verwendete Lucene-Passagen
                      </div>
                      <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                        {msg.passages.map((p, pIdx) => (
                          <div
                            key={pIdx}
                            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700/80 bg-slate-50 dark:bg-slate-900/80 text-[11px] space-y-1 min-w-0 overflow-hidden break-words"
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">
                                {p.documentTitle}
                              </span>
                              <button
                                type="button"
                                onClick={() => onNavigateToDocument(p.documentId, p.pageNumber)}
                                className="shrink-0 px-1.5 py-0.5 rounded bg-purple-500/10 hover:bg-purple-500/20 text-purple-600 dark:text-purple-400 font-mono text-[10px] font-semibold flex items-center gap-0.5 transition"
                              >
                                <span>S. {p.pageNumber}</span>
                                <ExternalLink className="w-2.5 h-2.5" />
                              </button>
                            </div>
                            <p className="text-slate-600 dark:text-slate-300 italic line-clamp-3 break-words [overflow-wrap:anywhere]">
                              "{p.passageText}"
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}

        {/* Live streaming message */}
        {ragLoading && (
          <div className="w-full min-w-0 max-w-full rounded-2xl rounded-tl-xs border border-purple-200 dark:border-purple-800/80 bg-white dark:bg-slate-800 p-3 shadow-xs space-y-2 overflow-hidden break-words [overflow-wrap:anywhere] animate-in fade-in duration-200">
            <div className="flex items-center justify-between text-[10px] text-slate-400 pb-1.5 border-b border-slate-100 dark:border-slate-700">
              <span className="flex items-center gap-1.5 font-semibold text-purple-600 dark:text-purple-400">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Generiere Antwort…</span>
              </span>
              {ragStreamingPassages.length > 0 && (
                <span className="text-[10px] text-purple-500 font-medium">
                  {ragStreamingPassages.length} Quellen gefunden
                </span>
              )}
            </div>

            <div className="space-y-2 min-w-0 max-w-full break-words [overflow-wrap:anywhere]">
              {ragStreamingText ? (
                renderGroundedAnswer(ragStreamingText, ragStreamingPassages)
              ) : (
                <p className="text-xs text-slate-400 italic">
                  Recherchiere im Dokumentbestand und befrage Ollama…
                </p>
              )}
            </div>
          </div>
        )}
        <div ref={ragMessagesEndRef} />
      </div>

      {/* Chat Input Bar */}
      <div className="p-2.5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1.5 shrink-0">
        {ragMessages.length > 0 && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setRagMessages([])}
              className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition"
            >
              Chat-Verlauf leeren
            </button>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendRagQuery();
          }}
          className="flex items-end gap-1.5"
        >
          <textarea
            rows={2}
            value={ragQuery}
            onChange={(e) => setRagQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendRagQuery();
              }
            }}
            placeholder={
              ragScope === 'current' && activeDoc
                ? `Frage an ${formatDocTitle(activeDoc)}…`
                : 'Frage an die Bibliothek stellen…'
            }
            className="flex-1 resize-none px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-hidden focus:ring-1 focus:ring-purple-500 leading-normal"
          />
          {ragLoading ? (
            <button
              type="button"
              onClick={handleStopRagStream}
              className="p-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white transition shrink-0"
              title="Generierung anhalten"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!ragQuery.trim()}
              className="p-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-40 transition shrink-0 shadow-xs"
              title="Frage absenden (Enter)"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </form>
      </div>
    </div>
  );
});

