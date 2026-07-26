import { useRef } from 'react';

import { addNode } from '../mermaid/mutate';
import { setDirection } from '../mermaid/mutate';
import { useStore } from '../state/store';

const DIRECTIONS = ['TD', 'LR', 'BT', 'RL'];

function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function Toolbar(): JSX.Element {
  const source = useStore((s) => s.source);
  const setSource = useStore((s) => s.setSource);
  const select = useStore((s) => s.select);
  const diagram = useStore((s) => s.diagram);
  const session = useStore((s) => s.session);
  const sessions = useStore((s) => s.sessions);
  const loadSession = useStore((s) => s.loadSession);
  const newSession = useStore((s) => s.newSession);
  const renameSession = useStore((s) => s.renameSession);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const past = useStore((s) => s.past);
  const future = useStore((s) => s.future);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportSvg = () => {
    const svg = document.querySelector('.preview-svg svg');
    if (!svg) return;
    download(`${session?.title ?? 'diagram'}.svg`, new XMLSerializer().serializeToString(svg), 'image/svg+xml');
  };

  const exportPng = () => {
    const svg = document.querySelector('.preview-svg svg') as SVGSVGElement | null;
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    const scale = 2;
    const data = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = box.width * scale;
      canvas.height = box.height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${session?.title ?? 'diagram'}.png`;
        a.click();
        URL.revokeObjectURL(url);
      });
    };
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(data)))}`;
  };

  const openFile = async (file: File) => {
    const text = await file.text();
    setSource(text);
    if (session) void renameSession(file.name.replace(/\.mmd$/, ''));
  };

  return (
    <header className="toolbar">
      <div className="toolbar-group">
        <strong className="brand">MDVE</strong>
        <select
          value={session?.id ?? ''}
          onChange={(e) => void loadSession(e.target.value)}
          title="Open diagram"
        >
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <button onClick={() => void newSession()}>New</button>
        <button
          onClick={() => {
            const title = prompt('Diagram name', session?.title ?? '');
            if (title) void renameSession(title);
          }}
        >
          Rename
        </button>
      </div>

      <div className="toolbar-group">
        <button
          onClick={() => {
            const { source: next, id } = addNode(source);
            setSource(next);
            select({ kind: 'node', id });
          }}
        >
          + Node
        </button>
        <select
          value={diagram.direction}
          disabled={diagram.unsupported}
          onChange={(e) => setSource(setDirection(source, e.target.value))}
          title="Layout direction"
        >
          {DIRECTIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <button onClick={undo} disabled={past.length === 0} title="Undo">
          ↶
        </button>
        <button onClick={redo} disabled={future.length === 0} title="Redo">
          ↷
        </button>
      </div>

      <div className="toolbar-group toolbar-right">
        <button onClick={() => fileRef.current?.click()}>Open .mmd</button>
        <input
          ref={fileRef}
          type="file"
          accept=".mmd,.mermaid,.txt"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void openFile(file);
            e.target.value = '';
          }}
        />
        <button onClick={() => download(`${session?.title ?? 'diagram'}.mmd`, source, 'text/plain')}>
          Save .mmd
        </button>
        <button onClick={exportSvg}>SVG</button>
        <button onClick={exportPng}>PNG</button>
      </div>
    </header>
  );
}
