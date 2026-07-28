export type IconName = 'fit' | 'plus' | 'redo' | 'undo' | 'zoom-in' | 'zoom-out';

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
    </svg>
  );
}
