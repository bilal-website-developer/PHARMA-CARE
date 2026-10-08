import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { migrateLegacyStorageKeys } from './utils/storageMigration';
import { APP_NAME } from './constants/brand';

migrateLegacyStorageKeys();
document.title = APP_NAME;
createRoot(document.getElementById('root')!).render(<App />);
