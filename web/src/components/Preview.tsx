import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { reservedIdsIn, type Diagram } from '../mermaid/parse';
import { setNodeLabel } from '../mermaid/mutate';
import { useStore, type Selection } from '../state/store';
import { Icon } from './Icon';

let mermaidPromise: Promise<typeof import('mermaid').default> | undefined;

function loadMermaid(): Promise<typeof import('mermaid').default> {
  mermaidPromise ??= import('mermaid').then(({ default: instance }) => {
    instance.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: 'dark',
      suppressErrorRendering: true,
      flowchart: { htmlLabels: true, curve: 'basis' },
    });
    return instance;
  });
  return mermaidPromise;
}

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

function selectionForTarget(
  target: Element,
  diagram: Diagram,
  knownNodeIds: Set<string>,
): Exclude<Selection, { kind: 'none' }> | null {
  const node = target.closest('g.node');
  if (node) {
    const id = nodeIdOf(node);
    return id ? { kind: 'node', id } : null;
  }

  const edgeElement = target.closest('.edgePaths path, .flowchart-link');
  const ends = edgeElement && edgeEndsOf(edgeElement, knownNodeIds);
  const edge = ends && diagram.edges.find((candidate) => candidate.from === ends.from && candidate.to === ends.to);
  return edge ? { kind: 'edge', key: edge.key } : null;
}

export function Preview(): JSX.Element {
  const source = useStore((s) => s.source);
  const selection = useStore((s) => s.selection);
  const diagram = useStore((s) => s.diagram);
  const select = useStore((s) => s.select);
  const setSource = useStore((s) => s.setSource);
  const session = useStore((s) => s.session);
  const renderError = useStore((s) => s.renderError);
  const setRenderError = useStore((s) => s.setRenderError);
  const reserved = useMemo(() => (renderError ? reservedIdsIn(source) : []), [renderError, source]);
  const knownNodeIds = useMemo(() => new Set(diagram.nodes.map((node) => node.id)), [diagram.nodes]);

  const previewRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  /** Pan is an offset from centred; the centring itself is computed below. */
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);
  const draggedRef = useRef(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [inlineDraft, setInlineDraft] = useState('');
  const [inlineEditorRect, setInlineEditorRect] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const editable = !session?.archived && !session?.trashed && !session?.agentLease;
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

  const positionInlineEditor = useCallback((id: string) => {
    const preview = previewRef.current;
    const host = hostRef.current;
    if (!preview || !host) return;
    const node = Array.from(host.querySelectorAll('g.node')).find((element) => nodeIdOf(element) === id);
    if (!node) return;
    const nodeBox = node.getBoundingClientRect();
    const previewBox = preview.getBoundingClientRect();
    if (nodeBox.width <= 0 || nodeBox.height <= 0) return;
    setInlineEditorRect({
      left: nodeBox.left - previewBox.left,
      top: nodeBox.top - previewBox.top,
      width: Math.max(120, nodeBox.width),
      height: Math.max(36, nodeBox.height),
    });
  }, []);

  const beginInlineEdit = useCallback((id: string) => {
    if (!editable) return;
    const node = diagram.nodes.find((candidate) => candidate.id === id);
    if (!node) return;
    setInlineDraft(node.label);
    setEditingNodeId(id);
    requestAnimationFrame(() => positionInlineEditor(id));
  }, [diagram.nodes, editable, positionInlineEditor]);

  const finishInlineEdit = useCallback((commit: boolean) => {
    if (!editingNodeId) return;
    const id = editingNodeId;
    setEditingNodeId(null);
    if (commit) setSource(setNodeLabel(source, id, inlineDraft));
  }, [editingNodeId, inlineDraft, setSource, source]);

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
        const mermaid = await loadMermaid();
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
        hostRef.current.querySelectorAll('g.node').forEach((nodeElement) => {
          const nodeId = nodeIdOf(nodeElement);
          if (!nodeId) return;
          const node = diagram.nodes.find((candidate) => candidate.id === nodeId);
          const accessibleLabel =
            node?.label
              .replace(/<br\s*\/?>/gi, ' ')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim() || nodeElement.textContent?.replace(/\s+/g, ' ').trim() || nodeId;
          nodeElement.setAttribute('role', 'button');
          nodeElement.setAttribute('tabindex', '0');
          nodeElement.setAttribute('aria-label', `Node: ${accessibleLabel}`);
          nodeElement.addEventListener('dblclick', (event) => {
            event.preventDefault();
            beginInlineEdit(nodeId);
          });
          nodeElement.addEventListener('click', () => {
            select({ kind: 'node', id: nodeId });
            beginInlineEdit(nodeId);
          });
        });
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
          const ends = edgeEndsOf(path, knownNodeIds);
          if (ends) {
            hit.setAttribute('role', 'button');
            hit.setAttribute('tabindex', '0');
            hit.setAttribute('aria-label', `Link: ${ends.from} to ${ends.to}`);
          }
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
  }, [beginInlineEdit, select, source, diagram, knownNodeIds, setRenderError, fitToView]);

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
        host.querySelectorAll('.edgePaths path:not(.mdve-hit)').forEach((el) => {
          const ends = edgeEndsOf(el, knownNodeIds);
          if (ends && ends.from === edge.from && ends.to === edge.to) el.classList.add('mdve-selected');
        });
      }
    }
  }, [selection, source, diagram, knownNodeIds]);

  useEffect(() => {
    if (!editingNodeId) return;
    const reposition = () => positionInlineEditor(editingNodeId);
    reposition();
    window.addEventListener('resize', reposition);
    return () => window.removeEventListener('resize', reposition);
  }, [canvasSize, content, editingNodeId, positionInlineEditor, view]);

  const onClick = useCallback(
    (event: React.MouseEvent) => {
      if (draggedRef.current) {
        draggedRef.current = false;
        return;
      }
      const target = event.target as Element;
      const nextSelection = selectionForTarget(target, diagram, knownNodeIds) ?? { kind: 'none' };
      if (nextSelection.kind === 'node' && editable) {
        select(nextSelection);
        beginInlineEdit(nextSelection.id);
        return;
      }
      select(nextSelection);
    },
    [beginInlineEdit, diagram, editable, knownNodeIds, select],
  );

  const onDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as Element;
      const nextSelection = selectionForTarget(target, diagram, knownNodeIds);
      if (nextSelection?.kind !== 'node') return;
      event.preventDefault();
      beginInlineEdit(nextSelection.id);
    },
    [beginInlineEdit, diagram, knownNodeIds],
  );

  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey && Math.abs(event.deltaY) < 2) return;
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1);
    },
    [zoomBy],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const target = event.target as Element;
      const nextSelection = selectionForTarget(target, diagram, knownNodeIds);
      if (!nextSelection) return;
      event.preventDefault();
      if (nextSelection.kind === 'node' && event.key === 'Enter') {
        beginInlineEdit(nextSelection.id);
      } else {
        select(nextSelection);
      }
    },
    [beginInlineEdit, diagram, knownNodeIds, select],
  );

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    dragRef.current = { x: event.clientX, y: event.clientY, ox: view.x, oy: view.y, moved: false };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (Math.abs(event.clientX - drag.x) > 3 || Math.abs(event.clientY - drag.y) > 3) drag.moved = true;
    manualViewRef.current = true;
    setView((v) => ({ ...v, x: drag.ox + (event.clientX - drag.x), y: drag.oy + (event.clientY - drag.y) }));
  };

  const endDrag = () => {
    if (dragRef.current?.moved) {
      draggedRef.current = true;
      window.setTimeout(() => {
        draggedRef.current = false;
      }, 0);
    }
    dragRef.current = null;
  };

  // Centre the scaled diagram in the pane, then apply the user's pan.
  const offsetX = (canvasSize.width - content.width * view.scale) / 2 + view.x;
  const offsetY = (canvasSize.height - content.height * view.scale) / 2 + view.y;
  const stageTransform = `translate(${offsetX}px, ${offsetY}px) scale(${view.scale})`;

  return (
    <div className="preview" ref={previewRef}>
      <div className="preview-tools" aria-label="Preview controls">
        <button className="icon-button" onClick={() => zoomBy(1.2)} title="Zoom in" aria-label="Zoom in">
          <Icon name="zoom-in" />
        </button>
        <button className="icon-button" onClick={() => zoomBy(1 / 1.2)} title="Zoom out" aria-label="Zoom out">
          <Icon name="zoom-out" />
        </button>
        <button
          className="icon-button"
          onClick={() => {
            manualViewRef.current = false;
            fitToView();
          }}
          title="Fit to view"
          aria-label="Fit diagram to view"
        >
          <Icon name="fit" />
        </button>
        <span className="zoom-label" aria-label={`Zoom ${Math.round(view.scale * 100)} percent`}>
          {Math.round(view.scale * 100)}%
        </span>
      </div>

      <div
        className="preview-canvas"
        ref={canvasRef}
        role="region"
        aria-label="Diagram preview"
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
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

      {editingNodeId && (
        <input
          className="preview-inline-editor"
          aria-label="Edit node label"
          value={inlineDraft}
          style={{
            left: inlineEditorRect.left,
            top: inlineEditorRect.top,
            width: inlineEditorRect.width,
            height: inlineEditorRect.height,
          }}
          autoFocus
          onChange={(event) => setInlineDraft(event.target.value)}
          onBlur={() => finishInlineEdit(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              finishInlineEdit(true);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              finishInlineEdit(false);
            }
          }}
          onPointerDown={(event) => event.stopPropagation()}
        />
      )}

      {renderError && (
        <div className="preview-error" role="alert" aria-live="assertive">
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
