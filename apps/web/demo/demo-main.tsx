import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/src/client/app';
import '@/src/client/globals.css';
import 'streamdown/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
