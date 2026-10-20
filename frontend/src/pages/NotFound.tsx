import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <main className="center-page" data-testid="not-found">
      <h1>Seite nicht gefunden</h1>
      <Link to="/">Zur Startseite</Link>
    </main>
  );
}
