import { useEffect, useRef, useState } from 'react';

import { api, type LicenseStatus } from '../api';
import { Icon } from './Icon';

export function LicenseDialog({
  open,
  status,
  onClose,
  onChanged,
}: {
  open: boolean;
  status: LicenseStatus | null;
  onClose: () => void;
  onChanged: (status: LicenseStatus) => void;
}): JSX.Element | null {
  const [licenseKey, setLicenseKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLicenseKey('');
    requestAnimationFrame(() => keyRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  const activate = async () => {
    if (!licenseKey.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onChanged(await api.activateLicense(licenseKey));
      setLicenseKey('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message.replace(/^\d+\s+/, '') : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async () => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await api.deactivateLicense());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message.replace(/^\d+\s+/, '') : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog license-dialog" role="dialog" aria-modal="true" aria-labelledby="license-dialog-title">
        <header className="dialog-header">
          <div className="dialog-heading">
            <span className="dialog-icon"><Icon name="key" /></span>
            <div>
              <span className="dialog-eyebrow">MDVE Pro</span>
              <h2 id="license-dialog-title">Keep your diagrams moving</h2>
            </div>
          </div>
          <button type="button" className="dialog-close" aria-label="Close licensing dialog" onClick={onClose}>×</button>
        </header>

        <div className="dialog-body">
          {status?.plan === 'pro' ? (
            <div className="license-active" role="status" aria-live="polite">
              <span className="license-active-mark">✓</span>
              <div>
                <strong>MDVE Pro is active</strong>
                <p>{status.detail}</p>
              </div>
            </div>
          ) : (
            <>
              <p className="dialog-lead">The complete local Mermaid workbench stays free. Pro adds a clean presentation mode for sharing diagrams from the desktop app.</p>
              <div className="license-value-grid">
                <div><strong>One-time</strong><span>$49 early access</span></div>
                <div><strong>Local-first</strong><span>No MDVE account required</span></div>
                <div><strong>BYOK friendly</strong><span>Your AI key stays yours</span></div>
              </div>
            </>
          )}

          {status?.checkoutUrl ? (
            <a className="button-primary license-checkout" href={status.checkoutUrl} target="_blank" rel="noreferrer">
              Get MDVE Pro
            </a>
          ) : (
            <p className="license-not-configured">The Pro checkout link will appear here when the product store is connected.</p>
          )}

          <div className="license-divider"><span>Already purchased?</span></div>
          <label className="dialog-field" htmlFor="mdve-license-key">
            <span>License key</span>
            <input
              ref={keyRef}
              id="mdve-license-key"
              type="password"
              autoComplete="off"
              placeholder="Paste your MDVE Pro key"
              value={licenseKey}
              onChange={(event) => setLicenseKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void activate();
              }}
              disabled={busy}
            />
          </label>
          <div className="dialog-actions">
            <button type="button" onClick={() => void activate()} disabled={busy || !licenseKey.trim()}>
              {busy ? 'Verifying…' : 'Activate on this device'}
            </button>
            {status?.plan === 'pro' && <button type="button" className="danger" onClick={() => void deactivate()} disabled={busy}>Deactivate</button>}
          </div>
          {error && <p className="dialog-error" role="alert">{error}</p>}
          <p className="dialog-footnote">Verification runs through the configured store. MDVE stores only the key needed to re-check this device, with restrictive local file permissions.</p>
        </div>
      </section>
    </div>
  );
}
