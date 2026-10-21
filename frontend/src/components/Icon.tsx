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
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0',
  'bell-off': 'M6 16V11a6 6 0 0 1 9.5-4.9M18 11v5l1.5 2H8M10 20.5a2 2 0 0 0 4 0M4 4l16 16',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-2 1.2L14.8 21h-4l-.3-2.4a7 7 0 0 1-2-1.2l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-3L4.6 9.3l2-3.4 1.9.7a7 7 0 0 1 2-1.2L10.8 3h4l.3 2.4a7 7 0 0 1 2 1.2l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 3z',
  share:
    'M12 3v12M8 7l4-4 4 4M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1',
  'plus-square':
    'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM12 8v8M8 12h8',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21',
  'mic-off':
    'M15 9.5V6a3 3 0 0 0-5.7-1.3M9 9v3a3 3 0 0 0 4.9 2.3M5.5 11a6.5 6.5 0 0 0 10.6 5M18.5 11a6.4 6.4 0 0 1-.6 2.7M12 17.5V21M4 4l16 16',
  speaker: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11',
  waveform: 'M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2',
  stop: 'M7 7h10v10H7z',
  play: 'M8 5.5v13l10-6.5z',
  pause: 'M8 5v14M16 5v14',
  headphones:
    'M4 15v-3a8 8 0 0 1 16 0v3M4 15a2 2 0 0 1 2-2h1v7H6a2 2 0 0 1-2-2zM20 15a2 2 0 0 0-2-2h-1v7h1a2 2 0 0 0 2-2z',
  'phone-off':
    'M5 15.5l-1.6-1.6a1.5 1.5 0 0 1 0-2.1C5.6 9.6 8.7 8.5 12 8.5s6.4 1.1 8.6 3.3a1.5 1.5 0 0 1 0 2.1L19 15.5a1 1 0 0 1-1.3.1l-2.4-1.7a1 1 0 0 1-.4-.8V11a10 10 0 0 0-5.8 0v2.1a1 1 0 0 1-.4.8l-2.4 1.7a1 1 0 0 1-1.3-.1z',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4',
  moon: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  auto: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 3v18',
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
