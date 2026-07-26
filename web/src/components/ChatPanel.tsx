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
  const setProvider = useStore((s) => s.setProvider);
  const setModel = useStore((s) => s.setModel);

  const [input, setInput] = useState('');
  const [showTrace, setShowTrace] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const provider = providers.find((p) => p.id === providerId);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
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
        { prompt, providerId, model: model || undefined },
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
    <section className="chat">
      <header className="chat-header">
        <div className="chat-provider">
          <select value={providerId} onChange={(e) => setProvider(e.target.value)}>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          {provider && provider.models.length > 0 && (
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {provider.models.map((m) => (
                <option key={m || 'default'} value={m}>
                  {m || 'default model'}
                </option>
              ))}
            </select>
          )}
        </div>
        {provider && !provider.status.ok && <p className="chat-warning">{provider.status.detail}</p>}
      </header>

      <div className="chat-log" ref={scrollRef}>
        {chat.length === 0 && (
          <div className="chat-empty">
            <p>The agent reads and edits this diagram directly.</p>
            <ul>
              <li>“Add an error path from the decision node”</li>
              <li>“Turn this into a swimlane-style flow with subgraphs”</li>
              <li>“Rename every node to sentence case”</li>
            </ul>
          </div>
        )}

        {chat.map((message) => (
          <article key={message.id} className={`msg msg-${message.role}${message.error ? ' msg-error' : ''}`}>
            {message.trace && message.trace.length > 0 && showTrace && (
              <ul className="msg-trace">
                {message.trace.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
            <div className="msg-text">
              {message.text || (message.pending ? <span className="dots">working…</span> : null)}
            </div>
          </article>
        ))}
      </div>

      <footer className="chat-input">
        <textarea
          value={input}
          placeholder={busy ? 'Agent is working…' : 'Ask the agent to change the diagram'}
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
            trace
          </label>
          {busy ? (
            <button className="danger" onClick={() => session && void api.stop(session.id)}>
              Stop
            </button>
          ) : (
            <button onClick={() => void submit()} disabled={!input.trim()}>
              Send
            </button>
          )}
        </div>
      </footer>
    </section>
  );
}
