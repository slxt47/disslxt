import { passwordRules, passwordStrength, type PasswordContext } from '@disslxt/shared';
import { Icon } from './Icon';

const LEVELS = ['Zu schwach', 'Zu schwach', 'Gut', 'Stark', 'Sehr stark'];

/** Live view of the password policy while typing: strength bar and one line per rule. */
export function PasswordChecklist({
  password,
  context,
}: {
  password: string;
  context: PasswordContext;
}) {
  if (!password) return null;
  const rules = passwordRules(password, context);
  const strength = passwordStrength(password, context);
  return (
    <div className="pw-check" data-testid="password-checklist" data-strength={strength}>
      <div className="pw-meter" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={i <= strength ? `on s${strength}` : ''} />
        ))}
      </div>
      <p className="pw-level" aria-live="polite">
        Passwortstärke: {LEVELS[strength]}
      </p>
      <ul>
        {rules.map((r) => (
          <li
            key={r.id}
            className={r.ok ? 'ok' : ''}
            data-testid={`pw-rule-${r.id}`}
            data-ok={r.ok}
          >
            <Icon name={r.ok ? 'check' : 'close'} size={14} />
            <span>{r.label}</span>
            <span className="sr-only">{r.ok ? 'erfüllt' : 'nicht erfüllt'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
