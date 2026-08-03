import { useEffect, useRef, useState } from 'react';

import { api, streamChat } from '../api';
import { useStore } from '../state/store';

let turnSeq = 0;

export function ChatPanel({ onConfigureByok }: { onConfigureByok?: () => void }): JSX.Element {
  const chat = useStore((s) => s.chat);
  const busy = useStore((s) => s.busy);
  const agentProposal = useStore((s) => s.agentProposal);
  const session = useStore((s) => s.session);
  const conversations = useStore((s) => s.conversations);
  const conversationId = useStore((s) => s.conversationId);
  const providers = useStore((s) => s.providers);
  const providerId = useStore((s) => s.providerId);
  const model = useStore((s) => s.model);
  const effort = useStore((s) => s.effort);
  const setProvider = useStore((s) => s.setProvider);
  const setModel = useStore((s) => s.setModel);
  const setEffort = useStore((s) => s.setEffort);
  const selectConversation = useStore((s) => s.selectConversation);
  const newConversation = useStore((s) => s.newConversation);
  const archiveConversation = useStore((s) => s.archiveConversation);
  const restoreConversation = useStore((s) => s.restoreConversation);
  const loadConversations = useStore((s) => s.loadConversations);
  const beginAgentProposal = useStore((s) => s.beginAgentProposal);
  const stageAgentSource = useStore((s) => s.stageAgentSource);
  const acceptAgentProposal = useStore((s) => s.acceptAgentProposal);
  const rejectAgentProposal = useStore((s) => s.rejectAgentProposal);

  const [input, setInput] = useState('');
  const [showTrace, setShowTrace] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const provider = providers.find((p) => p.id === providerId);
  const modelInfo = provider?.models.find((m) => m.id === model);
  const conversation = conversations.find((candidate) => candidate.id === conversationId);
  const settingsSummary = [provider?.label ?? 'No provider', modelInfo?.label ?? 'No model', effort || 'default'].join(' · ');

  useEffect(() => {
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior });
  }, [chat]);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      const prompt = (event as CustomEvent<string>).detail;
      if (!prompt) return;
      setInput(prompt);
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    window.addEventListener('mdve:agent-prompt', onPrompt);
    return () => window.removeEventListener('mdve:agent-prompt', onPrompt);
  }, []);

  const submit = async () => {
    const prompt = input.trim();
    const state = useStore.getState();
    if (!prompt || state.busy || state.agentProposal || !session || session.archived || state.conversations.find((item) => item.id === state.conversationId)?.archived) return;

    if (!state.conversationId) {
      await newConversation();
    }
    const activeConversationId = useStore.getState().conversationId;
    if (!activeConversationId) return;

    setInput('');
    state.appendChat({ id: `u${++turnSeq}`, role: 'user', text: prompt });
    const turnId = `a${++turnSeq}`;
    state.appendChat({ id: turnId, role: 'agent', text: '', trace: [], pending: true });
    beginAgentProposal();
    state.setBusy(true);

    try {
      await streamChat(
        session.id,
        { prompt, providerId, model: model || undefined, effort: effort || undefined, conversationId: activeConversationId },
        {
          onAgent: (event) => useStore.getState().applyAgentEvent(turnId, event),
          onDiagram: (source, state) => {
            stageAgentSource(source, state);
          },
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
      const proposal = useStore.getState().agentProposal;
      if (proposal && proposal.before === proposal.after) useStore.getState().acceptAgentProposal();
      void loadConversations();
    }
  };

  const proposalDelta = agentProposal?.delta;
  const proposalChanges = proposalDelta
    ? proposalDelta.addedNodes.length + proposalDelta.removedNodes.length + proposalDelta.changedNodes.length
      + proposalDelta.addedEdges.length + proposalDelta.removedEdges.length + proposalDelta.changedEdges.length
      + proposalDelta.movedNodes.length
    : 0;

  return (
    <section className="chat" aria-labelledby="agent-heading">
      <header className="chat-header">
        <div className="chat-title-row">
          <h2 id="agent-heading">Agent</h2>
          <span className={`provider-state${provider?.status.ok ? ' provider-ready' : ''}`}>
            {provider?.status.ok ? 'Ready' : 'Unavailable'}
          </span>
        </div>
        <div className="chat-conversation">
          <label htmlFor="conversation-select">Conversation</label>
          <select
            id="conversation-select"
            value={conversationId ?? ''}
            onChange={(event) => void selectConversation(event.target.value)}
            disabled={busy || conversations.length === 0}
          >
            {conversations.length === 0 && <option value="">No conversation yet</option>}
            {conversations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}{item.archived ? ' (archived)' : ''} · {item.status}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void newConversation()} disabled={busy || Boolean(session?.archived)}>
            New conversation
          </button>
          {conversation?.archived ? (
            <button type="button" onClick={() => void restoreConversation()} disabled={busy}>
              Restore conversation
            </button>
          ) : (
            <button type="button" onClick={() => void archiveConversation()} disabled={busy || !conversation}>
              Archive conversation
            </button>
          )}
        </div>
        {conversation && (
          <p className="chat-conversation-status" role="status" aria-live="polite">
            {conversation.status} · Diagram revision {conversation.lastRevision}
          </p>
        )}
        <details className="chat-settings">
          <summary>
            <span className="chat-settings-title">Agent settings</span>
            <span className="chat-settings-value" title={settingsSummary}>{settingsSummary}</span>
          </summary>
          <div className="chat-provider">
            <label>
              <span className="sr-only">Provider</span>
              <select aria-label="Provider" value={providerId} onChange={(e) => setProvider(e.target.value)}>
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
                <select aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)}>
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
                <select aria-label="Reasoning effort" value={effort} onChange={(e) => setEffort(e.target.value)}>
                  {modelInfo.efforts.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {providerId === 'openai-compatible' && onConfigureByok && (
              <button type="button" className="byok-settings-button" onClick={onConfigureByok}>
                Configure BYOK
              </button>
            )}
          </div>
        </details>
        {provider && !provider.status.ok && <p className="chat-warning">{provider.status.detail}</p>}
      </header>

      <div className="chat-log" ref={scrollRef} role="log" tabIndex={0} aria-live="polite" aria-label="Agent conversation">
        {chat.length === 0 && (
          <div className="chat-empty">
            <strong>Describe a diagram change</strong>
            <p>The agent works against this Diagram's current Mermaid source.</p>
            <details className="chat-examples">
              <summary>Example requests</summary>
              <ul>
                <li>“Add an error path from the decision node”</li>
                <li>“Turn this into a swimlane-style flow with subgraphs”</li>
                <li>“Rename every node to sentence case”</li>
              </ul>
            </details>
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
          ref={inputRef}
          id="agent-prompt"
          aria-label="Change request"
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
          disabled={busy || Boolean(agentProposal) || Boolean(session?.archived) || Boolean(conversation?.archived)}
        />
        <div className="chat-actions">
          <label className="trace-toggle">
            <input type="checkbox" checked={showTrace} onChange={(e) => setShowTrace(e.target.checked)} />
            Show trace
          </label>
          {busy ? (
            <button type="button" className="danger" onClick={() => session && void api.stop(session.id)}>
              Stop
            </button>
          ) : (
            <button className="button-primary" onClick={() => void submit()} disabled={!input.trim() || Boolean(agentProposal)}>
              Send
            </button>
          )}
        </div>
        {agentProposal && proposalChanges > 0 && (
          <section className="agent-proposal" aria-label="Agent proposal" role="status">
            <div className="agent-proposal-heading">
              <span className="agent-proposal-kicker">Agent proposal</span>
              <strong>{proposalChanges} modeled change{proposalChanges === 1 ? '' : 's'}</strong>
            </div>
            <p>
              {proposalDelta?.addedNodes.length ?? 0} added · {proposalDelta?.removedNodes.length ?? 0} removed · {proposalDelta?.changedNodes.length ?? 0} relabeled · {proposalDelta?.movedNodes.length ?? 0} moved
            </p>
            <div className="agent-proposal-actions">
              <button type="button" className="button-primary" onClick={acceptAgentProposal} disabled={busy}>Keep changes</button>
              <button type="button" className="danger" onClick={rejectAgentProposal} disabled={busy}>Reject proposal</button>
            </div>
          </section>
        )}
      </footer>
    </section>
  );
}
