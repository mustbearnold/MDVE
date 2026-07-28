import { useEffect, useRef, useState } from 'react';

import { api, streamChat } from '../api';
import { useStore } from '../state/store';

let turnSeq = 0;

export function ChatPanel(): JSX.Element {
  const chat = useStore((s) => s.chat);
  const busy = useStore((s) => s.busy);
  const session = useStore((s) => s.session);
  const providers = useStore((s) => s.providers);
  const providerId = useStore((s) => s.providerId);
  const model = useStore((s) => s.model);
  const effort = useStore((s) => s.effort);
  const setProvider = useStore((s) => s.setProvider);
  const setModel = useStore((s) => s.setModel);
  const setEffort = useStore((s) => s.setEffort);

  const [input, setInput] = useState('');
  const [showTrace, setShowTrace] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const provider = providers.find((p) => p.id === providerId);
  const modelInfo = provider?.models.find((m) => m.id === model);

  useEffect(() => {
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior });
  }, [chat]);

  const submit = async () => {
    const prompt = input.trim();
    const state = useStore.getState();
    if (!prompt || state.busy || !session) return;

    setInput('');
    state.appendChat({ id: `u${++turnSeq}`, role: 'user', text: prompt });
    const turnId = `a${++turnSeq}`;
    state.appendChat({ id: turnId, role: 'agent', text: '', trace: [], pending: true });
    state.setBusy(true);

    try {
      await streamChat(
        session.id,
        { prompt, providerId, model: model || undefined, effort: effort || undefined },
        {
          onAgent: (event) => useStore.getState().applyAgentEvent(turnId, event),
          onDiagram: (source) => useStore.getState().setSource(source, { persist: false }),
        },
      );
    } catch (err) {
      useStore.getState().patchChat(turnId, {
        error: true,
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      useStore.getState().patchChat(turnId, { pending: false });
      useStore.getState().setBusy(false);
    }
  };

  return (
    <section className="chat" aria-labelledby="agent-heading">
      <header className="chat-header">
        <div className="chat-title-row">
          <h2 id="agent-heading">Agent</h2>
          <span className={`provider-state${provider?.status.ok ? ' provider-ready' : ''}`}>
            {provider?.status.ok ? 'Ready' : 'Unavailable'}
          </span>
        </div>
        <div className="chat-provider">
          <label>
            <span className="sr-only">Provider</span>
            <select value={providerId} onChange={(e) => setProvider(e.target.value)}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {provider && provider.models.length > 0 && (
            <label>
              <span className="sr-only">Model</span>
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {provider.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                    {m.deprecated ? ' (deprecated)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          {modelInfo && modelInfo.efforts.length > 0 && (
            <label className="effort-select">
              <span className="sr-only">Reasoning effort</span>
              <select value={effort} onChange={(e) => setEffort(e.target.value)}>
                {modelInfo.efforts.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {provider && !provider.status.ok && <p className="chat-warning">{provider.status.detail}</p>}
      </header>

      <div className="chat-log" ref={scrollRef} role="log" aria-live="polite" aria-label="Agent conversation">
        {chat.length === 0 && (
          <div className="chat-empty">
            <strong>Describe a diagram change</strong>
            <p>The agent works against this Diagram's current Mermaid source.</p>
            <ul>
              <li>“Add an error path from the decision node”</li>
              <li>“Turn this into a swimlane-style flow with subgraphs”</li>
              <li>“Rename every node to sentence case”</li>
            </ul>
          </div>
        )}

        {chat.map((message) => (
          <article
            key={message.id}
            className={`msg msg-${message.role}${message.error ? ' msg-error' : ''}`}
            aria-label={message.role === 'user' ? 'You' : 'Agent'}
          >
            {message.trace && message.trace.length > 0 && showTrace && (
              <ul className="msg-trace">
                {message.trace.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
            <div className="msg-text">
              {message.text || (message.pending ? <span className="dots" role="status">Working…</span> : null)}
            </div>
          </article>
        ))}
      </div>

      <footer className="chat-input">
        <label className="chat-prompt-label" htmlFor="agent-prompt">
          Change request
        </label>
        <textarea
          id="agent-prompt"
          value={input}
          placeholder={busy ? 'Agent is working…' : 'For example: add a retry path after validation'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={3}
        />
        <div className="chat-actions">
          <label className="trace-toggle">
            <input type="checkbox" checked={showTrace} onChange={(e) => setShowTrace(e.target.checked)} />
            Show trace
          </label>
          {busy ? (
            <button className="danger" onClick={() => session && void api.stop(session.id)}>
              Stop
            </button>
          ) : (
            <button className="button-primary" onClick={() => void submit()} disabled={!input.trim()}>
              Send
            </button>
          )}
        </div>
      </footer>
    </section>
  );
}
