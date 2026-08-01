import { create } from 'zustand';

import { AgentEvent, ConversationRecord, ProviderInfo, SessionMeta, api } from '../api';
import { Diagram, parseDiagram } from '../mermaid/parse';
import { clearRecoveryDraft, readRecoveryDraft, writeRecoveryDraft } from './drafts';
import { createDiagramPersistence, type SaveStatus } from './persistence';

export type Selection =
  | { kind: 'none' }
  | { kind: 'node'; id: string }
  | { kind: 'edge'; key: string };

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  /** Tool/status lines attached to an agent turn. */
  trace?: string[];
  pending?: boolean;
  error?: boolean;
}

interface Store {
  session: SessionMeta | null;
  sessions: SessionMeta[];
  librarySearch: string;
  workspace: string;
  conversations: ConversationRecord[];
  conversationId: string | null;

  source: string;
  diagram: Diagram;
  revision: number;
  draftStatus: 'clear' | 'available' | 'degraded';
  selection: Selection;
  renderError: string | null;
  saveStatus: SaveStatus;

  past: string[];
  future: string[];

  chat: ChatMessage[];
  busy: boolean;
  providers: ProviderInfo[];
  providerId: string;
  model: string;
  effort: string;

  setSource: (source: string, opts?: { history?: boolean; persist?: boolean }) => void;
  select: (selection: Selection) => void;
  setRenderError: (error: string | null) => void;
  undo: () => void;
  redo: () => void;
  retrySave: () => void;
  setRevision: (revision: number) => void;
  resolveConflict: (choice: 'local' | 'current') => void;

  loadSession: (id?: string) => Promise<void>;
  refreshSessions: () => Promise<void>;
  setLibrarySearch: (search: string) => void;
  newSession: () => Promise<void>;
  renameSession: (title: string) => Promise<void>;
  archiveSession: () => Promise<void>;
  restoreSession: () => Promise<void>;

  loadConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  newConversation: () => Promise<void>;
  archiveConversation: () => Promise<void>;
  restoreConversation: () => Promise<void>;

  loadProviders: () => Promise<void>;
  setProvider: (id: string) => void;
  setModel: (model: string) => void;
  setEffort: (effort: string) => void;

  appendChat: (message: ChatMessage) => void;
  patchChat: (id: string, patch: Partial<ChatMessage>) => void;
  applyAgentEvent: (turnId: string, event: AgentEvent) => void;
  setBusy: (busy: boolean) => void;
}

const HISTORY_LIMIT = 200;
let diagramPersistence: ReturnType<typeof createDiagramPersistence>;

function chatForConversation(conversation: ConversationRecord | undefined): ChatMessage[] {
  return (conversation?.messages ?? []).map((message) => ({
    id: `conversation:${message.id}`,
    role: message.role,
    text: message.text,
    trace: message.trace,
    error: message.error,
  }));
}

function selectedConversation(records: ConversationRecord[], preferredId?: string): ConversationRecord | undefined {
  return (
    records.find((record) => record.id === preferredId && !record.archived) ??
    records.find((record) => !record.archived) ??
    records.find((record) => record.id === preferredId) ??
    records[0]
  );
}

async function flushDiagramBeforeNavigation(diagram: SessionMeta | null): Promise<void> {
  if (!diagram) return;
  await diagramPersistence.flush(diagram.id);
  const saveStatus = diagramPersistence.status(diagram.id);
  if (saveStatus.state === 'error') {
    throw new Error(`Could not save ${diagram.title}: ${saveStatus.message}`);
  }
}

export const useStore = create<Store>((set, get) => ({
  session: null,
  sessions: [],
  librarySearch: '',
  workspace: '',
  conversations: [],
  conversationId: null,

  source: '',
  diagram: parseDiagram(''),
  revision: 0,
  draftStatus: 'clear',
  selection: { kind: 'none' },
  renderError: null,
  saveStatus: { state: 'saved' },

  past: [],
  future: [],

  chat: [],
  busy: false,
  providers: [],
  providerId: 'codex',
  model: '',
  effort: '',

  setSource: (source, opts = {}) => {
    const { source: previous, session } = get();
    if (source === previous) return;
    if (session && opts.persist !== false && (session.archived || session.agentLease)) return;
    const history = opts.history !== false;
    set((state) => ({
      source,
      diagram: parseDiagram(source),
      past: history ? [...state.past, previous].slice(-HISTORY_LIMIT) : state.past,
      future: history ? [] : state.future,
    }));
    if (opts.persist !== false && session) {
      void writeRecoveryDraft({ sessionId: session.id, source, baseRevision: get().revision, updatedAt: Date.now() }).catch(() => {
        if (useStore.getState().session?.id === session.id) useStore.setState({ draftStatus: 'degraded' });
      });
      diagramPersistence.schedule(session.id, source);
    }
  },

  select: (selection) => set({ selection }),
  setRenderError: (renderError) => set({ renderError }),

  undo: () => {
    const { past, source, future, session } = get();
    if (past.length === 0 || session?.archived || session?.agentLease) return;
    const previous = past[past.length - 1];
    set({
      source: previous,
      diagram: parseDiagram(previous),
      past: past.slice(0, -1),
      future: [source, ...future].slice(0, HISTORY_LIMIT),
    });
    if (session) diagramPersistence.schedule(session.id, previous);
  },

  redo: () => {
    const { future, source, past, session } = get();
    if (future.length === 0 || session?.archived || session?.agentLease) return;
    const next = future[0];
    set({
      source: next,
      diagram: parseDiagram(next),
      past: [...past, source].slice(-HISTORY_LIMIT),
      future: future.slice(1),
    });
    if (session) diagramPersistence.schedule(session.id, next);
  },

  retrySave: () => {
    const { session } = get();
    if (session) void diagramPersistence.retry(session.id);
  },

  setRevision: (revision) =>
    set((state) => ({
      revision,
      session: state.session ? { ...state.session, revision } : state.session,
    })),

  resolveConflict: (choice) => {
    const { session, source, saveStatus } = get();
    if (!session || saveStatus.state !== 'conflict') return;
    const nextRevision = saveStatus.actualRevision;
    diagramPersistence.seed(session.id, nextRevision);
    if (choice === 'current') {
      set((state) => ({
        source: saveStatus.currentSource,
        diagram: parseDiagram(saveStatus.currentSource),
        revision: nextRevision,
        past: [],
        future: [],
        session: state.session ? { ...state.session, revision: nextRevision } : state.session,
      }));
      diagramPersistence.schedule(session.id, saveStatus.currentSource);
    } else {
      set((state) => ({
        revision: nextRevision,
        session: state.session ? { ...state.session, revision: nextRevision } : state.session,
      }));
      diagramPersistence.schedule(session.id, source);
    }
  },

  loadSession: async (id) => {
    await flushDiagramBeforeNavigation(get().session);

    let targetId = id;
    if (!targetId) targetId = (await api.startup()).session.id;
    const { session, source, workspace } = await api.getSession(targetId);
    diagramPersistence.seed(session.id, session.revision ?? 0);
    set({
      session,
      workspace,
      source,
      diagram: parseDiagram(source),
      revision: session.revision ?? 0,
      draftStatus: 'clear',
      past: [],
      future: [],
      selection: { kind: 'none' },
      chat: [],
      conversations: [],
      conversationId: null,
      busy: Boolean(session.agentLease),
      saveStatus: diagramPersistence.status(session.id),
    });
    localStorage.setItem('mdve.session', session.id);
    await get().refreshSessions();
    await get().loadConversations();
    try {
      const draft = await readRecoveryDraft(session.id);
      if (draft && draft.source !== source) {
        if (draft.baseRevision === (session.revision ?? 0)) {
          set({ draftStatus: 'available' });
          get().setSource(draft.source, { history: false });
        } else {
          set({ draftStatus: 'available' });
        }
      }
    } catch {
      set({ draftStatus: 'degraded' });
    }
  },

  refreshSessions: async () => {
    const { librarySearch } = get();
    const { sessions } = await api.listSessions('all', librarySearch);
    set({ sessions });
  },

  setLibrarySearch: (librarySearch) => {
    set({ librarySearch });
    void get().refreshSessions();
  },

  newSession: async () => {
    await flushDiagramBeforeNavigation(get().session);
    const { session } = await api.createSession();
    await get().loadSession(session.id);
  },

  renameSession: async (title) => {
    const { session } = get();
    if (!session) return;
    const res = await api.renameSession(session.id, title);
    set({ session: res.session });
    await get().refreshSessions();
  },

  archiveSession: async () => {
    const { session } = get();
    if (!session) return;
    await flushDiagramBeforeNavigation(session);
    await api.archiveSession(session.id);
    await get().refreshSessions();
    const next = get().sessions.find((candidate) => !candidate.archived && !candidate.trashed);
    if (next) await get().loadSession(next.id);
    else await get().loadSession();
  },

  restoreSession: async () => {
    const { session } = get();
    if (!session) return;
    const result = await api.restoreSession(session.id);
    set({ session: result.session });
    await get().refreshSessions();
  },

  loadConversations: async () => {
    const { session } = get();
    if (!session) return;
    try {
      const { conversations } = await api.conversations(session.id);
      const selected = selectedConversation(conversations, session.selectedConversationId);
      set((state) => ({
        conversations,
        conversationId: selected?.id ?? null,
        chat: chatForConversation(selected),
        session: state.session ? { ...state.session, selectedConversationId: selected?.id } : state.session,
      }));
    } catch {
      // Keep older workspaces usable; the first send creates the store.
      set({ conversations: [], conversationId: null, chat: [] });
    }
  },

  selectConversation: async (id) => {
    const conversation = get().conversations.find((candidate) => candidate.id === id);
    if (!conversation) return;
    set((state) => ({
      conversationId: id,
      chat: chatForConversation(conversation),
      session: state.session ? { ...state.session, selectedConversationId: id } : state.session,
    }));
    const session = get().session;
    if (session) await api.selectConversation(session.id, id).catch(() => undefined);
  },

  newConversation: async () => {
    const { session, providerId } = get();
    if (!session || session.archived) return;
    await flushDiagramBeforeNavigation(session);
    const { conversation } = await api.createConversation(session.id, undefined, providerId);
    set((state) => ({
      conversations: [conversation, ...state.conversations.filter((candidate) => candidate.id !== conversation.id)],
      conversationId: conversation.id,
      chat: [],
      session: state.session ? { ...state.session, selectedConversationId: conversation.id } : state.session,
    }));
  },

  archiveConversation: async () => {
    const { session, conversationId } = get();
    if (!session || !conversationId) return;
    await api.archiveConversation(session.id, conversationId);
    await get().loadConversations();
  },

  restoreConversation: async () => {
    const { session, conversationId } = get();
    if (!session || !conversationId) return;
    await api.restoreConversation(session.id, conversationId);
    await get().loadConversations();
  },

  loadProviders: async () => {
    const { providers } = await api.providers();
    set((state) => {
      const providerId = providers.some((p) => p.id === state.providerId)
        ? state.providerId
        : providers[0]?.id ?? 'codex';
      const provider = providers.find((p) => p.id === providerId);
      const model = provider?.models.some((m) => m.id === state.model)
        ? state.model
        : provider?.defaultModel ?? '';
      const modelInfo = provider?.models.find((m) => m.id === model);
      const effort = modelInfo?.efforts.includes(state.effort)
        ? state.effort
        : provider?.defaultEffort ?? modelInfo?.defaultEffort ?? '';
      return { providers, providerId, model, effort };
    });
  },

  setProvider: (providerId) => {
    const provider = get().providers.find((p) => p.id === providerId);
    const model = provider?.defaultModel ?? '';
    const modelInfo = provider?.models.find((m) => m.id === model);
    set({ providerId, model, effort: provider?.defaultEffort ?? modelInfo?.defaultEffort ?? '' });
  },

  setModel: (model) => {
    const { providers, providerId, effort } = get();
    const modelInfo = providers.find((p) => p.id === providerId)?.models.find((m) => m.id === model);
    // Keep the current effort when the new model supports it, else fall back.
    set({
      model,
      effort: modelInfo?.efforts.includes(effort) ? effort : modelInfo?.defaultEffort ?? '',
    });
  },

  setEffort: (effort) => set({ effort }),

  appendChat: (message) => set((state) => ({ chat: [...state.chat, message] })),

  patchChat: (id, patch) =>
    set((state) => ({
      chat: state.chat.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),

  applyAgentEvent: (turnId, event) => {
    const { patchChat, chat } = get();
    const current = chat.find((m) => m.id === turnId);
    if (!current) return;

    switch (event.type) {
      case 'message':
        patchChat(turnId, { text: `${current.text}${event.text}` });
        break;
      case 'tool':
        patchChat(turnId, {
          trace: [...(current.trace ?? []), `${event.name}${event.detail ? `: ${event.detail}` : ''}`],
        });
        break;
      case 'reasoning':
        patchChat(turnId, { trace: [...(current.trace ?? []), event.text.split('\n')[0]] });
        break;
      case 'error':
        patchChat(turnId, { error: true, text: current.text ? `${current.text}\n\n${event.message}` : event.message });
        break;
      case 'usage':
        patchChat(turnId, {
          trace: [...(current.trace ?? []), `tokens in ${event.input} / out ${event.output}`],
        });
        break;
      case 'status':
        break;
      case 'done':
        patchChat(turnId, { pending: false });
        break;
    }
  },

  setBusy: (busy) => set({ busy }),
}));

diagramPersistence = createDiagramPersistence(api.saveDiagram, {
  onStatus: (sessionId, saveStatus) => {
    if (useStore.getState().session?.id === sessionId) useStore.setState({ saveStatus });
  },
  onSaved: (sessionId, result) => {
    if (useStore.getState().session?.id !== sessionId || !result || typeof result !== 'object') return;
    const revision = 'revision' in result && typeof result.revision === 'number' ? result.revision : undefined;
    const historyAvailable = 'historyAvailable' in result && typeof result.historyAvailable === 'boolean' ? result.historyAvailable : undefined;
    useStore.setState((state) => ({
      revision: revision ?? state.revision,
      session: state.session && revision !== undefined ? { ...state.session, revision } : state.session,
      draftStatus: 'clear',
      saveStatus: historyAvailable === undefined ? state.saveStatus : { state: 'saved', historyAvailable },
    }));
    if (revision !== undefined) void clearRecoveryDraft(sessionId, revision).catch(() => undefined);
  },
});
