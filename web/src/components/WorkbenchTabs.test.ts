import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { WORKBENCH_VIEWS, WorkbenchTabs } from './WorkbenchTabs';

test('workbench tabs expose every narrow-layout pane with one active view', () => {
  const selections: string[] = [];
  const component = WorkbenchTabs({
    activeView: 'source',
    onChange: (view) => selections.push(view),
  });
  const html = renderToStaticMarkup(
    React.createElement(WorkbenchTabs, {
      activeView: 'source',
      onChange: () => undefined,
    }),
  );

  assert.equal(WORKBENCH_VIEWS.length, 5);
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.equal((html.match(/aria-pressed="false"/g) ?? []).length, 4);

  for (const view of WORKBENCH_VIEWS) {
    assert.match(html, new RegExp(`aria-controls="workbench-${view.id}"`));
    assert.match(html, new RegExp(`>${view.label}</button>`));
  }

  const buttons = React.Children.toArray(component.props.children) as React.ReactElement<{
    onClick: () => void;
  }>[];
  buttons[2].props.onClick();
  assert.deepEqual(selections, ['inspector']);
});
