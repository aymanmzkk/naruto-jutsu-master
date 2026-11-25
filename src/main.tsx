import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/rajdhani/500.css';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import '@fontsource/noto-serif-jp/700.css';
import '@fontsource/noto-serif-jp/900.css';
import './styles/global.css';
import './styles/menu.css';
import './styles/hud.css';
import './styles/lab.css';
import './styles/completion.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
