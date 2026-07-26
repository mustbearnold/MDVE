import { create } from 'zustand';

import { AgentEvent, ProviderInfo, SessionMeta, api } from '../api';
import { Diagram, parseDiagram } from '../mermaid/parse';

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
  workspace: string;

  source: string;
  diagram: Diagram;
  selection: Selection;
  renderError: string | null;

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

  loadSession: (id?: string) => Promise<void>;
  refreshSessions: () => Promise<void>;
  newSession: () => Promise<void>;
  renameSession: (title: string) => Promise<void>;

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
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function persist(sessionId: string, source: string): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void api.saveDiagram(sessionId, source).catch(() => undefined);
  }, 250);
}

export const useStore = create<Store>((set, get) => ({
  session: null,
  sessions: [],
  workspace: '',

  source: '',
  diagram: parseDiagram(''),
  selection: { kind: 'none' },
  renderError: null,

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
    const history = opts.history !== false;
    set((state) => ({
      source,
      diagram: parseDiagram(source),
      past: history ? [...state.past, previous].slice(-HISTORY_LIMIT) : state.past,
      future: history ? [] : state.future,
    }));
    if (opts.persist !== false && session) persist(session.id, source);
  },

  select: (selection) => set({ selection }),
  setRenderError: (renderError) => set({ renderError }),

  undo: () => {
    const { past, source, future, session } = get();
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    set({
      source: previous,
      diagram: parseDiagram(previous),
      past: past.slice(0, -1),
      future: [source, ...future].slice(0, HISTORY_LIMIT),
    });
    if (session) persist(session.id, previous);
  },

  redo: () => {
    const { future, source, past, session } = get();
    if (future.length === 0) return;
    const next = future[0];
    set({
      source: next,
      diagram: parseDiagram(next),
      past: [...past, source].slice(-HISTORY_LIMIT),
      future: future.slice(1),
    });
    if (session) persist(session.id, next);
  },

  loadSession: async (id) => {
    let targetId = id;
    if (!targetId) {
      const { sessions } = await api.listSessions();
      targetId = sessions[0]?.id ?? (await api.createSession()).session.id;
    }
    const { session, source, workspace } = await api.getSession(targetId);
    set({
      session,
      workspace,
      source,
      diagram: parseDiagram(source),
      past: [],
      future: [],
      selection: { kind: 'none' },
      chat: [],
    });
    localStorage.setItem('mdve.session', session.id);
    await get().refreshSessions();
  },

  refreshSessions: async () => {
    const { sessions } = await api.listSessions();
    set({ sessions });
  },

  newSession: async () => {
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
        patchChat(turnId, { text: current.text ? `${current.text}\n\n${event.text}` : event.text });
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
