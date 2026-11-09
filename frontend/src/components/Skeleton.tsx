/** Grey placeholders while a list loads, in the shape of what is coming. */
const WIDTHS = [62, 38, 74, 52, 30, 66];

export function MessageSkeleton() {
  return (
    <ul className="skeleton-list" data-testid="message-skeleton" aria-hidden="true">
      {WIDTHS.map((w) => (
        <li key={w} className="skeleton-message">
          <span className="skeleton avatar" />
          <span className="skeleton-lines">
            <span className="skeleton line" style={{ width: '22%' }} />
            <span className="skeleton line" style={{ width: `${w}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function LineSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <ul className="skeleton-rows" data-testid="line-skeleton" aria-hidden="true">
      {WIDTHS.slice(0, rows).map((w) => (
        <li key={w}>
          <span className="skeleton line" style={{ width: `${w + 20}%` }} />
        </li>
      ))}
    </ul>
  );
}
