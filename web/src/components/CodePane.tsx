import { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';

import { useStore } from '../state/store';

const theme = EditorView.theme(
  {
    '&': { height: '100%', fontSize: '13px', backgroundColor: 'transparent' },
    '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: '1.55' },
    '.cm-content': { caretColor: '#e6edf3' },
    '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: '#4b5563' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '&.cm-focused': { outline: '2px solid var(--focus)', outlineOffset: '-2px' },
  },
  { dark: true },
);

export function CodePane(): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const setSource = useStore((s) => s.setSource);
  const source = useStore((s) => s.source);
  const session = useStore((s) => s.session);
  const editable = !session?.archived && !session?.trashed && !session?.agentLease;
  const editableCompartment = useRef(new Compartment());

  useEffect(() => {
    if (!hostRef.current) return;

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: useStore.getState().source,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.lineWrapping,
          editableCompartment.current.of(EditorView.editable.of(editable)),
          EditorView.contentAttributes.of({ 'aria-label': 'Mermaid source' }),
          theme,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            setSource(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [setSource]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: editableCompartment.current.reconfigure(EditorView.editable.of(editable)) });
  }, [editable]);

  // Push external changes (agent edits, undo, inspector) into the editor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === source) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: source } });
  }, [source]);

  return <div className="code-pane" ref={hostRef} />;
}
