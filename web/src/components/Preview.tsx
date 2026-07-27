import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import mermaid from 'mermaid';

import { reservedIdsIn } from '../mermaid/parse';
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
  const reserved = useMemo(() => (renderError ? reservedIdsIn(source) : []), [renderError, source]);

  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  /** Pan is an offset from centred; the centring itself is computed below. */
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  /** Intrinsic size of the last render. */
  const [content, setContent] = useState({ width: 0, height: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const fitRef = useRef<{ width: number; height: number } | null>(null);
  /** Once the user zooms or pans, stop refitting on every edit. */
  const manualViewRef = useRef(false);

  const fitToView = useCallback(() => {
    const size = fitRef.current;
    const canvas = canvasRef.current;
    if (!size || !canvas) return;
    const box = canvas.getBoundingClientRect();
    // A collapsed or not-yet-laid-out pane would otherwise pin the zoom at the
    // floor and look like a broken render.
    if (box.width < 80 || box.height < 80) return;
    // Centring reads canvasSize, which only ever comes from the ResizeObserver.
    // Seed it from the measurement we already have so a fit is never applied
    // against a stale zero and thrown off-screen.
    setCanvasSize({ width: box.width, height: box.height });
    const scale = Math.min(1, (box.width - 48) / size.width, (box.height - 48) / size.height);
    setView({ x: 0, y: 0, scale: Math.max(0.05, scale) });
  }, []);

  const zoomBy = useCallback((factor: number) => {
    manualViewRef.current = true;
    setView((v) => ({ ...v, scale: Math.min(4, Math.max(0.05, v.scale * factor)) }));
  }, []);

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
          // Mermaid sizes the svg with `max-width`, which fights our own zoom
          // transform. Pin it to its intrinsic viewBox size instead — dropping
          // the width outright collapses the element to zero in a flex parent.
          const vb = el.viewBox.baseVal;
          if (vb && vb.width > 0) {
            el.style.maxWidth = 'none';
            el.style.width = `${vb.width}px`;
            el.style.height = `${vb.height}px`;
            fitRef.current = { width: vb.width, height: vb.height };
            setContent({ width: vb.width, height: vb.height });
          }
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
        if (!manualViewRef.current) fitToView();
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
  }, [source, setRenderError, fitToView]);

  // Refit when the pane itself changes size.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect;
      setCanvasSize({ width: box.width, height: box.height });
      if (!manualViewRef.current) fitToView();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [fitToView]);

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

  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey && Math.abs(event.deltaY) < 2) return;
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1);
    },
    [zoomBy],
  );

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 || (event.target as Element).closest('g.node')) return;
    dragRef.current = { x: event.clientX, y: event.clientY, ox: view.x, oy: view.y };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    manualViewRef.current = true;
    setView((v) => ({ ...v, x: drag.ox + (event.clientX - drag.x), y: drag.oy + (event.clientY - drag.y) }));
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  // Centre the scaled diagram in the pane, then apply the user's pan.
  const offsetX = (canvasSize.width - content.width * view.scale) / 2 + view.x;
  const offsetY = (canvasSize.height - content.height * view.scale) / 2 + view.y;
  const stageTransform = `translate(${offsetX}px, ${offsetY}px) scale(${view.scale})`;

  return (
    <div className="preview">
      <div className="preview-tools">
        <button onClick={() => zoomBy(1.2)} title="Zoom in">
          +
        </button>
        <button onClick={() => zoomBy(1 / 1.2)} title="Zoom out">
          −
        </button>
        <button
          onClick={() => {
            manualViewRef.current = false;
            fitToView();
          }}
          title="Fit to view"
        >
          ⤢
        </button>
        <span className="zoom-label">{Math.round(view.scale * 100)}%</span>
      </div>

      <div
        className="preview-canvas"
        ref={canvasRef}
        onClick={onClick}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          className="preview-stage"
          style={{ transform: stageTransform }}
        >
          <div ref={hostRef} className="preview-svg" />
        </div>
      </div>

      {renderError && (
        <div className="preview-error">
          <strong>Diagram error</strong>
          {reserved.length > 0 && (
            <p className="preview-hint">
              {reserved.map((id) => `"${id}"`).join(', ')}{' '}
              {reserved.length === 1
                ? 'is a Mermaid keyword and cannot be used as a node id. Rename it'
                : 'are Mermaid keywords and cannot be used as node ids. Rename them'}{' '}
              — this is very likely the cause.
            </p>
          )}
          <pre>{renderError}</pre>
        </div>
      )}
    </div>
  );
}
