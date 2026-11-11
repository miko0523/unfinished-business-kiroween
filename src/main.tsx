import { render } from 'preact';
import { App } from './components/App';
import { installInputModality } from './components/inputModality';
import { createBrowserAppContext } from './store/StoreContext';
import './styles.css';
import './ghost-motion.css';
import './farewell.css';
import './sky.css';
import './lamps.css';
import './archive.css';
import './collection.css';
import './stage.css';
import './language.css';

const root = document.getElementById('app');

async function boot(host: HTMLElement) {
  installInputModality();
  if (import.meta.env.DEV) {
    window.addEventListener('hashchange', () => window.location.reload());
    if (window.location.hash === '#/calibrate') {
      const { Calibrate } = await import('./dev/calibrate/Calibrate');
      render(<Calibrate />, host);
      return;
    }
  }
  render(<App context={createBrowserAppContext()} />, host);
}

if (root) {
  void boot(root);
}
