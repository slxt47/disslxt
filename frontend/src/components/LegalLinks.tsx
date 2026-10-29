/** Where the help, imprint and privacy policy live (separate static sites, see sites/). */
export const SITE_URLS = {
  help: 'https://disslxt-hilfe.slxt.org/',
  about: 'https://disslxt-info.slxt.org/',
  imprint: 'https://disslxt-info.slxt.org/impressum.html',
  privacy: 'https://disslxt-info.slxt.org/datenschutz.html',
} as const;

/** Small footer on the sign-in pages and in the settings: help, imprint, privacy policy. */
export function LegalLinks({ className = 'legal-links' }: { className?: string }) {
  return (
    <nav className={className} aria-label="Hilfe und Rechtliches" data-testid="legal-links">
      <a href={SITE_URLS.help} target="_blank" rel="noreferrer">
        Hilfe
      </a>
      <a href={SITE_URLS.imprint} target="_blank" rel="noreferrer">
        Impressum
      </a>
      <a href={SITE_URLS.privacy} target="_blank" rel="noreferrer">
        Datenschutz
      </a>
    </nav>
  );
}
