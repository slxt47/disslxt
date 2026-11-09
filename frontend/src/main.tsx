import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Himmel } from './components/Himmel';
import { registerServiceWorker } from './pwa/push';
import './styles.css';

registerServiceWorker();

const root = document.getElementById('root');
if (root) {
  const sky = document.getElementById('himmel');
  if (sky) createRoot(sky).render(<Himmel />);
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
