import './PharmaLogo.css';
import { APP_NAME } from '../constants/brand';

type Props = {
  size?: number;
  showText?: boolean;
  layout?: 'stacked' | 'inline';
  animated?: boolean;
  className?: string;
};

export default function PharmaLogo({ size = 10, showText = true, layout = 'stacked', animated = true, className = '' }: Props) {
  const [firstWord, ...rest] = APP_NAME.split(' ');

  return (
    <span
      className={`pc ${layout === 'inline' ? 'pc-inline' : ''} ${animated ? '' : 'pc-static'} ${className}`}
      style={{ fontSize: size }}
      role="img"
      aria-label={APP_NAME}
    >
      <span className="pc-mark" aria-hidden="true">
        <span className="pc-cap">
          <span className="pc-l">
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round"><path d="M12 4v16M4 12h16" /></svg>
          </span>
          <span className="pc-r">
            <svg viewBox="0 0 24 24" fill="#16A34A"><path d="M20 4C9 4 4 9 4 15c0 2 .8 3.5 2 4.5C7 14 11 11 16 9c-4 3-7 6-8.2 11.2C9 20.6 10.2 21 11.5 21 17 21 20 14 20 4z" /></svg>
          </span>
        </span>
      </span>
      {showText && <span className="pc-text" aria-hidden="true">{firstWord}<b>{rest.join('')}</b></span>}
    </span>
  );
}
