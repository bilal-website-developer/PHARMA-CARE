import { DEVELOPER } from '../config/developer';
import './GlowCredit.css';

export default function GlowCredit({ variant = 'dark' }: { variant?: 'dark' | 'light' }) {
  return (
    <div className={`gc gc-${variant}`}>
      <div className="gc-ring">
        <div className="gc-in">
          <div className="gc-cap">
            DEVELOPED BY
            <svg className="gc-heart" viewBox="0 0 24 24" fill="#ef4444"><path d="M12 21s-7-4.6-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.4-9.5 9-9.5 9z" /></svg>
          </div>
          <div className="gc-name">{DEVELOPER.name}</div>
          <a className="gc-phone" href={`tel:+${DEVELOPER.phoneE164}`}>
            <span className="gc-ico">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
            </span>
            {DEVELOPER.phoneDisplay}
          </a>
        </div>
      </div>
    </div>
  );
}
