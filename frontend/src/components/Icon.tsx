/** Line icons in the style of SF Symbols; they inherit the text colour and scale with font size. */
const PATHS = {
  menu: 'M4 7h16M4 12h16M4 17h16',
  edit: 'M14.5 5.5l4 4M4 20l1-5L15.5 4.5a1.4 1.4 0 0 1 2 0l2 2a1.4 1.4 0 0 1 0 2L9 19l-5 1z',
  trash:
    'M4.5 7h15M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  send: 'M12 19V5M6 11l6-6 6 6',
  hash: 'M9 4L7 20M17 4l-2 16M4.5 9h16M3.5 15h16',
  copy: 'M9 9h10v10a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 9 19zM15 9V5.5A1.5 1.5 0 0 0 13.5 4h-7A1.5 1.5 0 0 0 5 5.5v7A1.5 1.5 0 0 0 6.5 14H9',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10',
  alert:
    'M12 8v5M12 16.5v.5M10.3 4.2L2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = '1.25em' }: { name: IconName; size?: string | number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Initials avatar; the colour comes from the accent so the palette stays calm. */
export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const parts = name
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letters =
    parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : name.slice(0, 2);
  return (
    <span className={`avatar ${size}`} aria-hidden="true">
      {letters.toUpperCase() || '?'}
    </span>
  );
}
