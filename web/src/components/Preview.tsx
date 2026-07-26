import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

import { useStore } from '../state/store';

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'loose',
  theme: 'dark',
  suppressErrorRendering: true,
  flowchart: { htmlLabels: true, curve: 'basis' },
});

let renderSeq = 0;

/**
 * Reads the mermaid node id off a rendered `<g class="node">`. Mermaid ids look
 * like `<renderId>-flowchart-<nodeId>-<n>`.
 */
function nodeIdOf(el: Element): string | null {
  const dataId = el.getAttribute('data-id');
  if (dataId) return dataId;
  const m = /flowchart-(.+)-\d+$/.exec(el.id);
  return m ? m[1] : null;
}

/**
 * Reads `from`/`to` off a rendered edge path. Newer mermaid encodes them in the
 * element id as `L_<from>_<to>_<n>`; since ids may themselves contain `_`, the
 * split is resolved against the ids the parser knows about.
 */
function edgeEndsOf(el: Element, knownIds: Set<string>): { from: string; to: string } | null {
  let from: string | undefined;
  let to: string | undefined;
  for (const cls of Array.from(el.classList)) {
    if (cls.startsWith('LS-')) from = cls.slice(3);
    else if (cls.startsWith('LE-')) to = cls.slice(3);
  }
  if (from && to) return { from, to };

  const m = /L_(.+)_\d+$/.exec(el.id);
  if (!m) return null;
  const body = m[1];
  for (let i = 1; i < body.length; i++) {
    if (body[i] !== '_') continue;
    const left = body.slice(0, i);
    const right = body.slice(i + 1);
    if (knownIds.has(left) && knownIds.has(right)) return { from: left, to: right };
  }
  return null;
}

export function Preview(): JSX.Element {
  const source = useStore((s) => s.source);
  const selection = useStore((s) => s.selection);
  const diagram = useStore((s) => s.diagram);
  const select = useStore((s) => s.select);
  const renderError = useStore((s) => s.renderError);
  const setRenderError = useStore((s) => s.setRenderError);

  const hostRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const id = `mdve-svg-${++renderSeq}`;

    (async () => {
      if (!source.trim()) {
        if (hostRef.current) hostRef.current.innerHTML = '';
        setRenderError(null);
        return;
      }
      try {
        const { svg } = await mermaid.render(id, source);
        if (cancelled || !hostRef.current) return;
        hostRef.current.innerHTML = svg;
        const el = hostRef.current.querySelector('svg');
        if (el) {
          el.removeAttribute('width');
          el.style.maxWidth = 'none';
          el.style.height = 'auto';
        }
        // Rendered links are 1–2px wide, which is a miserable click target.
        // Shadow each one with a fat transparent path that takes the clicks.
        hostRef.current.querySelectorAll('.edgePaths path').forEach((path) => {
          const hit = path.cloneNode() as SVGPathElement;
          hit.setAttribute('class', 'mdve-hit');
          hit.setAttribute('stroke', 'transparent');
          hit.setAttribute('stroke-width', '14');
          hit.setAttribute('fill', 'none');
          hit.removeAttribute('marker-end');
          hit.removeAttribute('style');
          hit.id = `hit-${path.id}`;
          path.parentElement?.insertBefore(hit, path);
        });
        setRenderError(null);
      } catch (err) {
        if (cancelled) return;
        setRenderError(err instanceof Error ? err.message : String(err));
      } finally {
        document.getElementById(`d${id}`)?.remove();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, setRenderError]);

  // Selection highlight, re-applied after every render.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.querySelectorAll('.mdve-selected').forEach((el) => el.classList.remove('mdve-selected'));

    if (selection.kind === 'node') {
      host.querySelectorAll('g.node').forEach((el) => {
        if (nodeIdOf(el) === selection.id) el.classList.add('mdve-selected');
      });
    } else if (selection.kind === 'edge') {
      const edge = diagram.edges.find((e) => e.key === selection.key);
      if (edge) {
        const knownIds = new Set(diagram.nodes.map((n) => n.id));
        host.querySelectorAll('.edgePaths path:not(.mdve-hit)').forEach((el) => {
          const ends = edgeEndsOf(el, knownIds);
          if (ends && ends.from === edge.from && ends.to === edge.to) el.classList.add('mdve-selected');
        });
      }
    }
  }, [selection, source, diagram]);

  const onClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as Element;
      const node = target.closest('g.node');
      if (node) {
        const id = nodeIdOf(node);
        if (id) {
          select({ kind: 'node', id });
          return;
        }
      }
      const edgeEl = target.closest('.edgePaths path, .flowchart-link');
      if (edgeEl) {
        const knownIds = new Set(diagram.nodes.map((n) => n.id));
        const ends = edgeEndsOf(edgeEl, knownIds);
        if (ends) {
          const edge = diagram.edges.find((e) => e.from === ends.from && e.to === ends.to);
          if (edge) {
            select({ kind: 'edge', key: edge.key });
            return;
          }
        }
      }
      select({ kind: 'none' });
    },
    [diagram, select],
  );

  const onWheel = useCallback((event: React.WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey && Math.abs(event.deltaY) < 2) return;
    event.preventDefault();
    setView((v) => {
      const scale = Math.min(4, Math.max(0.2, v.scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
      return { ...v, scale };
    });
  }, []);

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 || (event.target as Element).closest('g.node')) return;
    dragRef.current = { x: event.clientX, y: event.clientY, ox: view.x, oy: view.y };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    setView((v) => ({ ...v, x: drag.ox + (event.clientX - drag.x), y: drag.oy + (event.clientY - drag.y) }));
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  return (
    <div className="preview">
      <div className="preview-tools">
        <button onClick={() => setView((v) => ({ ...v, scale: Math.min(4, v.scale * 1.2) }))} title="Zoom in">
          +
        </button>
        <button onClick={() => setView((v) => ({ ...v, scale: Math.max(0.2, v.scale / 1.2) }))} title="Zoom out">
          −
        </button>
        <button onClick={() => setView({ x: 0, y: 0, scale: 1 })} title="Reset view">
          ⤢
        </button>
        <span className="zoom-label">{Math.round(view.scale * 100)}%</span>
      </div>

      <div
        className="preview-canvas"
        onClick={onClick}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          className="preview-stage"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          <div ref={hostRef} className="preview-svg" />
        </div>
      </div>

      {renderError && (
        <div className="preview-error">
          <strong>Diagram error</strong>
          <pre>{renderError}</pre>
        </div>
      )}
    </div>
  );
}
