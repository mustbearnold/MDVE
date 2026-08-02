import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { addNode, deleteEdge, deleteNode, setNodeLabel } from '../mermaid/mutate';
import { reservedIdsIn, supportsStructuredEditing, type Diagram } from '../mermaid/parse';
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
  const dataFrom = el.getAttribute('data-mdve-from');
  const dataTo = el.getAttribute('data-mdve-to');
  if (dataFrom && dataTo) return { from: dataFrom, to: dataTo };

  let from: string | undefined;
  let to: string | undefined;
  for (const cls of Array.from(el.classList)) {
    if (cls.startsWith('LS-')) from = cls.slice(3);
    else if (cls.startsWith('LE-')) to = cls.slice(3);
  }
  if (from && to) return { from, to };

  const dataId = el.getAttribute('data-id');
  const dataIdMatch = dataId && /^L_(.+)_\d+$/.exec(dataId);
  if (dataIdMatch) {
    const body = dataIdMatch[1];
    for (let i = 1; i < body.length; i++) {
      if (body[i] !== '_') continue;
      const left = body.slice(0, i);
      const right = body.slice(i + 1);
      if (knownIds.has(left) && knownIds.has(right)) return { from: left, to: right };
    }
  }

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

function edgeEndsOfLabel(el: Element, knownIds: Set<string>): { from: string; to: string } | null {
  const labelId = el.querySelector('.label[data-id]')?.getAttribute('data-id');
  if (!labelId) return null;
  const m = /^L_(.+)_\d+$/.exec(labelId);
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

  const edgeLabel = target.closest('g.edgeLabel');
  const labelEnds = edgeLabel && edgeEndsOfLabel(edgeLabel, knownNodeIds);
  const labelEdge = labelEnds && diagram.edges.find((candidate) => candidate.from === labelEnds.from && candidate.to === labelEnds.to);
  if (labelEdge) return { kind: 'edge', key: labelEdge.key };

  const edgeElement = target.closest('.edgePaths path, .flowchart-link');
  const ends = edgeElement && edgeEndsOf(edgeElement, knownNodeIds);
  const edge = ends && diagram.edges.find((candidate) => candidate.from === ends.from && candidate.to === ends.to);
  return edge ? { kind: 'edge', key: edge.key } : null;
}

type ContextMenuTarget = Exclude<Selection, { kind: 'none' }> | null;
type ContextMenuState = { left: number; top: number; selection: ContextMenuTarget };
type Point = { x: number; y: number };
type DragState =
  | { kind: 'canvas'; x: number; y: number; ox: number; oy: number; moved: boolean }
  | { kind: 'node'; id: string; x: number; y: number; ox: number; oy: number; moved: boolean }
  | { kind: 'edge-label'; key: string; x: number; y: number; ox: number; oy: number; moved: boolean };

function decodePoints(encoded: string | null): Point[] | null {
  if (!encoded) return null;
  try {
    const points = JSON.parse(window.atob(encoded)) as unknown;
    if (!Array.isArray(points)) return null;
    return points.filter((point): point is Point => {
      if (!point || typeof point !== 'object') return false;
      const candidate = point as Record<string, unknown>;
      return typeof candidate.x === 'number' && typeof candidate.y === 'number';
    });
  } catch {
    return null;
  }
}

function encodePoints(points: Point[]): string {
  return window.btoa(JSON.stringify(points));
}

function pathForPoints(points: Point[]): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  return `M${first.x},${first.y}${rest.map((point) => `L${point.x},${point.y}`).join('')}`;
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
  const contextMenuRef = useRef<HTMLDivElement>(null);
  /** Pan is an offset from centred; the centring itself is computed below. */
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<DragState | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const draggedRef = useRef(false);
  const nodeOffsetsRef = useRef(new Map<string, Point>());
  const edgeLabelOffsetsRef = useRef(new Map<string, Point>());
  const renderedSourceRef = useRef<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [inlineDraft, setInlineDraft] = useState('');
  const [inlineEditorRect, setInlineEditorRect] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const editable = !session?.archived && !session?.trashed && !session?.agentLease;
  const structuredEditingAvailable = editable && supportsStructuredEditing(diagram, renderError);
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

  const applyNodeOffset = useCallback((id: string, offset: Point) => {
    const host = hostRef.current;
    if (!host) return;
    const node = Array.from(host.querySelectorAll('g.node')).find((element) => nodeIdOf(element) === id);
    if (!node) return;
    const baseTransform = node.getAttribute('data-mdve-base-transform') ?? node.getAttribute('transform') ?? '';
    node.setAttribute('data-mdve-base-transform', baseTransform);
    node.setAttribute('transform', offset.x === 0 && offset.y === 0 ? baseTransform : `translate(${offset.x} ${offset.y}) ${baseTransform}`);
  }, []);

  const applyEdgeLabelOffset = useCallback((key: string, offset: Point) => {
    const host = hostRef.current;
    if (!host) return;
    host.querySelectorAll('g.edgeLabel').forEach((label) => {
      if (label.getAttribute('data-mdve-edge-key') !== key) return;
      const baseTransform = label.getAttribute('data-mdve-base-transform') ?? label.getAttribute('transform') ?? '';
      label.setAttribute('data-mdve-base-transform', baseTransform);
      label.setAttribute('transform', offset.x === 0 && offset.y === 0 ? baseTransform : `translate(${offset.x} ${offset.y}) ${baseTransform}`);
    });
  }, []);

  const applyEdgeOffsets = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    host.querySelectorAll('.edgePaths path').forEach((path) => {
      const ends = edgeEndsOf(path, knownNodeIds);
      if (!ends) return;
      const baseD = path.getAttribute('data-mdve-base-d') ?? path.getAttribute('d');
      const basePointsEncoded = path.getAttribute('data-mdve-base-points') ?? path.getAttribute('data-points');
      if (!baseD || !basePointsEncoded) return;
      path.setAttribute('data-mdve-base-d', baseD);
      path.setAttribute('data-mdve-base-points', basePointsEncoded);
      const points = decodePoints(basePointsEncoded);
      if (!points || points.length === 0) return;
      const fromOffset = nodeOffsetsRef.current.get(ends.from);
      const toOffset = nodeOffsetsRef.current.get(ends.to);
      const adjusted = points.map((point, index) => {
        if (index === 0 && fromOffset) return { x: point.x + fromOffset.x, y: point.y + fromOffset.y };
        if (index === points.length - 1 && toOffset) return { x: point.x + toOffset.x, y: point.y + toOffset.y };
        return point;
      });
      path.setAttribute('d', pathForPoints(adjusted));
      path.setAttribute('data-points', encodePoints(adjusted));
    });
  }, [knownNodeIds]);

  const applyTransientOffsets = useCallback(() => {
    nodeOffsetsRef.current.forEach((offset, id) => applyNodeOffset(id, offset));
    edgeLabelOffsetsRef.current.forEach((offset, key) => applyEdgeLabelOffset(key, offset));
    applyEdgeOffsets();
  }, [applyEdgeLabelOffset, applyEdgeOffsets, applyNodeOffset]);

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
      if (renderedSourceRef.current !== source) {
        nodeOffsetsRef.current.clear();
        edgeLabelOffsetsRef.current.clear();
        renderedSourceRef.current = source;
      }
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
            if (draggedRef.current) return;
            select({ kind: 'node', id: nodeId });
            beginInlineEdit(nodeId);
          });
        });
        hostRef.current.querySelectorAll('g.edgeLabel').forEach((labelElement) => {
          const ends = edgeEndsOfLabel(labelElement, knownNodeIds);
          const edge = ends && diagram.edges.find((candidate) => candidate.from === ends.from && candidate.to === ends.to);
          if (!edge?.label) return;
          labelElement.setAttribute('data-mdve-edge-key', edge.key);
          labelElement.setAttribute('role', 'button');
          labelElement.setAttribute('tabindex', '0');
          labelElement.setAttribute('aria-label', `Edge label: ${edge.label}`);
        });
        // Rendered links are 1–2px wide, which is a miserable click target.
        // Shadow each one with a fat transparent path that takes the clicks.
        hostRef.current.querySelectorAll('.edgePaths path').forEach((path) => {
          const hit = path.cloneNode() as SVGPathElement;
          const endpointClasses = Array.from(path.classList).filter((name) => name.startsWith('LS-') || name.startsWith('LE-'));
          hit.setAttribute('class', ['mdve-hit', ...endpointClasses].join(' '));
          hit.setAttribute('stroke', 'transparent');
          hit.setAttribute('stroke-width', '14');
          hit.setAttribute('pointer-events', 'stroke');
          hit.setAttribute('fill', 'none');
          hit.removeAttribute('marker-end');
          hit.removeAttribute('style');
          path.setAttribute('pointer-events', 'none');
          hit.id = `hit-${path.id}`;
          const ends = edgeEndsOf(path, knownNodeIds);
          if (ends) {
            hit.setAttribute('data-mdve-from', ends.from);
            hit.setAttribute('data-mdve-to', ends.to);
            hit.setAttribute('role', 'button');
            hit.setAttribute('tabindex', '0');
            hit.setAttribute('aria-label', `Link: ${ends.from} to ${ends.to}`);
          }
          path.parentElement?.insertBefore(hit, path);
        });
        applyTransientOffsets();
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
  }, [applyTransientOffsets, beginInlineEdit, select, source, diagram, knownNodeIds, setRenderError, fitToView]);

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

  useEffect(() => {
    if (!contextMenu) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) setContextMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [contextMenu]);

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

  const onContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const preview = previewRef.current;
    if (!preview) return;
    const box = preview.getBoundingClientRect();
    const nextSelection = selectionForTarget(event.target as Element, diagram, knownNodeIds);
    select(nextSelection ?? { kind: 'none' });
    const padding = 8;
    const maxLeft = Math.max(padding, box.width - 196);
    const maxTop = Math.max(padding, box.height - 180);
    setContextMenu({
      left: Math.min(maxLeft, Math.max(padding, event.clientX - box.left)),
      top: Math.min(maxTop, Math.max(padding, event.clientY - box.top)),
      selection: nextSelection,
    });
  }, [diagram, knownNodeIds, select]);

  const addNodeFromContextMenu = useCallback(() => {
    if (!structuredEditingAvailable) return;
    const result = addNode(source);
    if (!result.id || result.source === source) return;
    setSource(result.source);
    select({ kind: 'node', id: result.id });
    setContextMenu(null);
  }, [select, setSource, source, structuredEditingAvailable]);

  const editNodeFromContextMenu = useCallback(() => {
    const target = contextMenu?.selection;
    if (!target || target.kind !== 'node') return;
    setContextMenu(null);
    beginInlineEdit(target.id);
  }, [beginInlineEdit, contextMenu?.selection]);

  const deleteNodeFromContextMenu = useCallback(() => {
    const target = contextMenu?.selection;
    if (!structuredEditingAvailable || !target || target.kind !== 'node') return;
    const nextSource = deleteNode(source, target.id);
    if (nextSource === source) return;
    setSource(nextSource);
    select({ kind: 'none' });
    setContextMenu(null);
  }, [contextMenu?.selection, select, setSource, source, structuredEditingAvailable]);

  const deleteEdgeFromContextMenu = useCallback(() => {
    const target = contextMenu?.selection;
    if (!structuredEditingAvailable || !target || target.kind !== 'edge') return;
    const nextSource = deleteEdge(source, target.key);
    if (nextSource === source) return;
    setSource(nextSource);
    select({ kind: 'none' });
    setContextMenu(null);
  }, [contextMenu?.selection, select, setSource, source, structuredEditingAvailable]);

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

  const moveDrag = useCallback((clientX: number, clientY: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (Math.abs(clientX - drag.x) > 3 || Math.abs(clientY - drag.y) > 3) drag.moved = true;
    if (drag.kind === 'node') {
      const scale = Math.max(0.05, view.scale);
      const offset = {
        x: drag.ox + (clientX - drag.x) / scale,
        y: drag.oy + (clientY - drag.y) / scale,
      };
      nodeOffsetsRef.current.set(drag.id, offset);
      applyNodeOffset(drag.id, offset);
      applyEdgeOffsets();
      return;
    }
    if (drag.kind === 'edge-label') {
      const scale = Math.max(0.05, view.scale);
      const offset = {
        x: drag.ox + (clientX - drag.x) / scale,
        y: drag.oy + (clientY - drag.y) / scale,
      };
      edgeLabelOffsetsRef.current.set(drag.key, offset);
      applyEdgeLabelOffset(drag.key, offset);
      return;
    }
    manualViewRef.current = true;
    setView((v) => ({ ...v, x: drag.ox + (clientX - drag.x), y: drag.oy + (clientY - drag.y) }));
  }, [applyEdgeLabelOffset, applyEdgeOffsets, applyNodeOffset, view.scale]);

  const endDrag = useCallback(() => {
    if (dragRef.current?.moved) {
      draggedRef.current = true;
      window.setTimeout(() => {
        draggedRef.current = false;
      }, 0);
    }
    dragRef.current = null;
    dragCleanupRef.current?.();
    dragCleanupRef.current = null;
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return;
    dragCleanupRef.current?.();
    const target = event.target as Element;
    const nextSelection = selectionForTarget(target, diagram, knownNodeIds);
    const isNodeDrag = nextSelection?.kind === 'node' && editable;
    const isEdgeLabelDrag = nextSelection?.kind === 'edge' && editable && Boolean(target.closest('g.edgeLabel[data-mdve-edge-key]'));
    if (isNodeDrag) {
      const offset = nodeOffsetsRef.current.get(nextSelection.id) ?? { x: 0, y: 0 };
      select(nextSelection);
      dragRef.current = {
        kind: 'node',
        id: nextSelection.id,
        x: event.clientX,
        y: event.clientY,
        ox: offset.x,
        oy: offset.y,
        moved: false,
      };
    } else if (isEdgeLabelDrag) {
      const offset = edgeLabelOffsetsRef.current.get(nextSelection.key) ?? { x: 0, y: 0 };
      select(nextSelection);
      dragRef.current = {
        kind: 'edge-label',
        key: nextSelection.key,
        x: event.clientX,
        y: event.clientY,
        ox: offset.x,
        oy: offset.y,
        moved: false,
      };
    } else {
      dragRef.current = { kind: 'canvas', x: event.clientX, y: event.clientY, ox: view.x, oy: view.y, moved: false };
    }
    if (!isNodeDrag && !isEdgeLabelDrag) event.preventDefault();
    const onWindowMove = (moveEvent: PointerEvent) => moveDrag(moveEvent.clientX, moveEvent.clientY);
    const onWindowEnd = () => endDrag();
    window.addEventListener('pointermove', onWindowMove);
    window.addEventListener('pointerup', onWindowEnd);
    window.addEventListener('pointercancel', onWindowEnd);
    dragCleanupRef.current = () => {
      window.removeEventListener('pointermove', onWindowMove);
      window.removeEventListener('pointerup', onWindowEnd);
      window.removeEventListener('pointercancel', onWindowEnd);
    };
  }, [diagram, editable, endDrag, knownNodeIds, moveDrag, select, view.x, view.y]);

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
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
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

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="preview-context-menu"
          role="menu"
          aria-label="Preview context menu"
          style={{ left: contextMenu.left, top: contextMenu.top }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setContextMenu(null);
            }
          }}
        >
          <button
            type="button"
            role="menuitem"
            autoFocus
            disabled={!structuredEditingAvailable}
            onClick={addNodeFromContextMenu}
          >
            Add node
          </button>
          {contextMenu.selection?.kind === 'node' && (
            <>
              <button type="button" role="menuitem" disabled={!editable} onClick={editNodeFromContextMenu}>
                Edit label
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!structuredEditingAvailable || deleteNode(source, contextMenu.selection.id) === source}
                onClick={deleteNodeFromContextMenu}
              >
                Delete node
              </button>
            </>
          )}
          {contextMenu.selection?.kind === 'edge' && (
            <button
              type="button"
              role="menuitem"
              disabled={!structuredEditingAvailable || deleteEdge(source, contextMenu.selection.key) === source}
              onClick={deleteEdgeFromContextMenu}
            >
              Delete link
            </button>
          )}
        </div>
      )}

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
