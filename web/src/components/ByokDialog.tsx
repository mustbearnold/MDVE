import { useEffect, useRef, useState } from 'react';

import { api, type OpenAICompatibleConfigSummary } from '../api';
import { Icon } from './Icon';

export function ByokDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element | null {
  const [config, setConfig] = useState<OpenAICompatibleConfigSummary>({ baseUrl: 'https://api.openai.com/v1', model: '', hasApiKey: false });
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [model, setModel] = useState(config.model);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const baseUrlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setApiKey('');
    void api.openAICompatibleConfig().then((next) => {
      setConfig(next);
      setBaseUrl(next.baseUrl);
      setModel(next.model);
    }).catch((reason) => setError(reason instanceof Error ? reason.message.replace(/^\d+\s+/, '') : String(reason)));
    requestAnimationFrame(() => baseUrlRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.saveOpenAICompatibleConfig({ baseUrl, model, ...(apiKey ? { apiKey } : {}) });
      setConfig(next);
      setApiKey('');
      onSaved();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message.replace(/^\d+\s+/, '') : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.clearOpenAICompatibleConfig();
      setConfig(next);
      setBaseUrl(next.baseUrl);
      setModel(next.model);
      setApiKey('');
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message.replace(/^\d+\s+/, '') : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog byok-dialog" role="dialog" aria-modal="true" aria-labelledby="byok-dialog-title">
        <header className="dialog-header">
          <div className="dialog-heading">
            <span className="dialog-icon"><Icon name="key" /></span>
            <div>
              <span className="dialog-eyebrow">Agent connection</span>
              <h2 id="byok-dialog-title">Use your own AI key</h2>
            </div>
          </div>
          <button type="button" className="dialog-close" aria-label="Close BYOK settings" onClick={onClose}>×</button>
        </header>
        <div className="dialog-body">
          <p className="dialog-lead">Connect OpenAI, OpenRouter, Ollama, LM Studio, or another OpenAI-compatible endpoint. MDVE sends the current diagram and prompt directly to that endpoint.</p>
          <div className="dialog-callout"><strong>Privacy boundary</strong><span>MDVE never sends this key to an MDVE server. It is stored in your local data directory with restrictive permissions.</span></div>
          <label className="dialog-field" htmlFor="byok-base-url"><span>Base URL</span><input ref={baseUrlRef} id="byok-base-url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" disabled={busy} /></label>
          <label className="dialog-field" htmlFor="byok-model"><span>Model</span><input id="byok-model" value={model} onChange={(event) => setModel(event.target.value)} placeholder="gpt-4.1-mini or your local model name" disabled={busy} /></label>
          <label className="dialog-field" htmlFor="byok-api-key"><span>API key {config.hasApiKey && <small>(saved; leave blank to keep it)</small>}</span><input id="byok-api-key" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={config.hasApiKey ? 'Leave blank to keep the saved key' : 'Paste an API key, or leave blank for local'} disabled={busy} /></label>
          <div className="dialog-actions">
            <button type="button" className="button-primary" onClick={() => void save()} disabled={busy || !baseUrl.trim() || !model.trim()}>{busy ? 'Saving…' : 'Save connection'}</button>
            <button type="button" className="danger" onClick={() => void clear()} disabled={busy}>Clear saved connection</button>
          </div>
          {error && <p className="dialog-error" role="alert">{error}</p>}
          <p className="dialog-footnote">BYOK is free. You pay the model provider directly, and MDVE keeps no usage-based AI margin.</p>
        </div>
      </section>
    </div>
  );
}
