import { createRoot } from 'react-dom/client';
import { PublicReceiptPage } from './components/PublicReceiptPage';

const receiptRoute = window.location.pathname.match(/^\/r\/([A-Za-z0-9_-]{22,128})\/?$/);
createRoot(document.getElementById('root')!).render(
  <PublicReceiptPage token={receiptRoute?.[1] ?? null} />,
);
