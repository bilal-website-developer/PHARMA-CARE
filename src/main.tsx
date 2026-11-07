import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { migrateLegacyStorageKeys } from './utils/storageMigration';
import { APP_NAME } from './constants/brand';

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error: unknown) => {
    console.error('Could not register the Pharma Care install service worker.', error);
  });
}

migrateLegacyStorageKeys();
document.title = APP_NAME;
createRoot(document.getElementById('root')!).render(<App />);
