export type IconName =
  | 'agent'
  | 'fit'
  | 'history'
  | 'inspector'
  | 'library'
  | 'link'
  | 'node'
  | 'outline'
  | 'plus'
  | 'preview'
  | 'redo'
  | 'source'
  | 'undo'
  | 'zoom-in'
  | 'zoom-out'
  | 'command';

export function Icon({ name }: { name: IconName }): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {name === 'plus' && <path d="M12 5v14M5 12h14" />}
      {name === 'undo' && (
        <>
          <path d="m9 7-5 5 5 5" />
          <path d="M5 12h8a6 6 0 0 1 6 6" />
        </>
      )}
      {name === 'redo' && (
        <>
          <path d="m15 7 5 5-5 5" />
          <path d="M19 12h-8a6 6 0 0 0-6 6" />
        </>
      )}
      {name === 'zoom-in' && (
        <>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.5 15.5 4 4M10.5 7.5v6M7.5 10.5h6" />
        </>
      )}
      {name === 'zoom-out' && (
        <>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.5 15.5 4 4M7.5 10.5h6" />
        </>
      )}
      {name === 'fit' && (
        <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
      )}
      {name === 'library' && (
        <>
          <path d="M5 6.5A1.5 1.5 0 0 1 6.5 5H19v14H6.5A1.5 1.5 0 0 1 5 17.5z" />
          <path d="M5 8h14M8 5v14" />
        </>
      )}
      {name === 'source' && (
        <>
          <path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14" />
        </>
      )}
      {name === 'preview' && (
        <>
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="m10 9 5 3-5 3z" />
        </>
      )}
      {name === 'inspector' && (
        <>
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4M8.5 11h5M11 8.5v5" />
        </>
      )}
      {name === 'agent' && (
        <>
          <path d="M7 8.5h10A2.5 2.5 0 0 1 19.5 11v4A2.5 2.5 0 0 1 17 17.5H12l-3.5 2v-2H7A2.5 2.5 0 0 1 4.5 15v-4A2.5 2.5 0 0 1 7 8.5Z" />
          <path d="M9 5.5h6M12 3.5v2M8.5 12h.01M12 12h.01M15.5 12h.01" />
        </>
      )}
      {name === 'history' && (
        <>
          <path d="M4 12a8 8 0 1 0 2.35-5.65L4 8.7" />
          <path d="M4 4v4.7h4.7M12 8v4l2.7 1.6" />
        </>
      )}
      {name === 'outline' && (
        <>
          <rect x="9" y="4" width="6" height="5" rx="1" />
          <rect x="4" y="15" width="6" height="5" rx="1" />
          <rect x="14" y="15" width="6" height="5" rx="1" />
          <path d="M12 9v3M7 12h10M7 12v3M17 12v3" />
        </>
      )}
      {name === 'node' && <rect x="5" y="5" width="14" height="14" rx="3" />}
      {name === 'link' && (
        <>
          <path d="m9 15-1.6 1.6a3.4 3.4 0 0 1-4.8-4.8L5 9.4a3.4 3.4 0 0 1 4.8 0" />
          <path d="m15 9 1.6-1.6a3.4 3.4 0 0 1 4.8 4.8L19 14.6a3.4 3.4 0 0 1-4.8 0" />
          <path d="m8 12 8 0" />
        </>
      )}
      {name === 'command' && (
        <>
          <rect x="4" y="4" width="16" height="16" rx="3" />
          <path d="M8 9h8M8 13h5M8 17h3" />
        </>
      )}
    </svg>
  );
}
