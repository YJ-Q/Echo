import { createElement } from 'react';

export function ConflictConfirmationPanel({ conflict, onKeepCurrent, onReapply, onEdit, submitting }) {
  if (!conflict) return null;
  const disabled = Boolean(submitting);
  return createElement('section', { className: 'conflict-confirmation-panel', 'data-conflict-panel': 'true' },
    createElement('h3', null, `Conflict: ${conflict.entityLabel ?? 'Unknown'}`),
    createElement('dl', { className: 'conflict-comparison' },
      row('Original', conflict.originalValue),
      row('Current', conflict.currentValue),
      row('Proposed', conflict.proposedValue)
    ),
    createElement('div', { className: 'conflict-actions' },
      createElement('button', {
        type: 'button', disabled, 'data-conflict-action': 'keep-current',
        onClick: disabled ? undefined : () => onKeepCurrent?.()
      }, 'Keep current'),
      createElement('button', {
        type: 'button', disabled, 'data-conflict-action': 'reapply',
        onClick: disabled ? undefined : () => onReapply?.(conflict.currentVersion)
      }, 'Reapply'),
      createElement('button', {
        type: 'button', disabled, 'data-conflict-action': 'edit',
        onClick: disabled ? undefined : () => onEdit?.()
      }, 'Edit')
    )
  );
}

function row(label, value) {
  return createElement('div', { key: label, className: 'conflict-row' },
    createElement('dt', null, label),
    createElement('dd', null, value == null ? '—' : String(value))
  );
}
