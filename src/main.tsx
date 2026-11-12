import { render } from 'preact';
import { App } from './components/App';
import { installInputModality } from './components/inputModality';
import { createBrowserAppContext } from './store/StoreContext';
import { createSoundController } from './sound/controller';
import { createSoundEngine } from './sound/engine';
import { browserAudioDeps, pageHidden } from './sound/browserAudio';
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
  const context = createBrowserAppContext();
  // 声音：每次加载都从关开始，不读写任何存储键，不创建音频环境、不加载内嵌音频模块；玩家按开关才出声（R14.1、R14.3）。
  const sound = createSoundController({
    engine: createSoundEngine(browserAudioDeps()),
    hidden: pageHidden(),
  });
  render(<App context={context} sound={sound} />, host);
}

if (root) {
  void boot(root);
}
