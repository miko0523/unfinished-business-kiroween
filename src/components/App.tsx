import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CopyKey } from '../i18n/copy';
import type { AnimEvent } from '../domain/types';
import { announce } from '../store/announce';
import { createAppContext, StoreContext, useAppContext, type AppContext } from '../store/StoreContext';
import { installFlushOnHide } from '../store/lifecycle';
import { useStore } from '../store/useStore';
import { createDemoContext, DemoControlContext, takeSnapshot, useDemoControl, writeHash, type DemoControl, type HashSnapshot } from '../demo/control';
import { Archive } from './Archive';
import { CameraControls } from './CameraControls';
import { CelebrationLayer } from './CelebrationLayer';
import { CreateForm } from './CreateForm';
import { DemoBar, TrySample } from './DemoBar';
import { House } from './House';
import { KeepCopy } from './KeepCopy';
import { LiveRegion } from './LiveRegion';
import { Recovery } from './Recovery';
import { Sky } from './Sky';
import { Lobby } from './Lobby';
import { ResidentLayer } from './ResidentLayer';
import { StorageNotice } from './StorageNotice';
import { TaskCard } from './TaskCard';
import { WarmLamps } from './WarmLamps';
import { useHashRoute } from './useHashRoute';
import { usePageHiddenFlag } from './usePageHidden';
import { LangSwitch } from './LangSwitch';
import { SoundSwitch } from './SoundSwitch';
import { SoundContext, useSoundController, useSoundCues, useSoundLifecycle } from './useSound';
import { createSoundController, type SoundController } from '../sound/controller';
import { LanguageScope } from './LanguageScope';
import { useCopy } from './useCopy';

function Shell() {
  const t = useCopy();
  usePageHiddenFlag();
  const { store, ui } = useAppContext();
  // 当前房子（真实或示例）的成功事件接到音效上。
  useSoundCues(useSoundController(), store, ui);
  const route = useHashRoute();
  const demo = useDemoControl();
  // 留下事件或文案键，切换语言后连已存在的播报也能重新译出。
  const [notice, setMessage] = useState<CopyKey | readonly AnimEvent[] | null>(null);
  const current = useStore(store, (s) => s);
  const message = notice === null ? '' : typeof notice === 'string' ? t(notice) : announce(notice, current);
  // 进出示例时，界面树会整个换新；新的一棵在挂上之后再把那句话交给读屏。
  useEffect(() => {
    const text = demo.takeAnnouncement();
    if (text) setMessage(text);
    // 子组件的挂载副作用先于这里执行；它们都看过“刚回来”之后，才在这里收尾。
    demo.endReturn();
  }, []);
  const selectedId = useStore(ui, (s) => s.selectedTaskId);
  const mode = useStore(store.session, (s) => s.mode);
  const recovering = mode === 'recovery';
  const previousMode = useRef(mode);
  // 从恢复界面出来的那一刻，轻轻告诉读屏的人发生了什么。
  useEffect(() => {
    if (previousMode.current === 'recovery' && mode !== 'recovery') {
      setMessage(mode === 'memory' ? 'recovery.live.blank' : 'recovery.live.fresh');
    }
    previousMode.current = mode;
  }, [mode]);
  // 舞台只显示已经长出的楼层（门厅 + grownFloors−1 层住宅 + 屋顶），只升不降。
  const floors = useStore(store, (s) => s.house.grownFloors);
  // 页面隐藏或离开时，立刻补写还没保存的变更。
  useEffect(() => installFlushOnHide(store), [store]);
  // 读屏播报的订阅要在界面提交的同一刻就位：放进下一帧才执行的 useEffect，页面刚画出来就搬进来的第一只会没人听见。
  useLayoutEffect(
    () =>
      store.subscribeEvents((events) => {
        if (announce(events, store.getState())) setMessage(events);
      }),
    [store],
  );
  // 庆祝演完（或被跳过）的那一刻，轻轻告诉读屏的人：都收好了。
  const celebrating = useStore(ui, (s) => s.celebration !== null);
  const wasCelebrating = useRef(celebrating);
  useEffect(() => {
    if (wasCelebrating.current && !celebrating) setMessage('live.farewellDone');
    wasCelebrating.current = celebrating;
  }, [celebrating]);
  // 地标：header（标题与四个小图标）、nav 在页脚里（纪念册入口）、唯一的 main、footer。Tab 顺序即 DOM 顺序：
  // 顶栏（留一份副本、试试示例、语言、声音）→ 存储提示 → 创建框 → 全景小按钮 → 住客（楼层从高到低、同层从左到右）→ 门厅纪念册按钮 → 详情卡 → 页脚的纪念册入口。
  return (
    <div class={demo.active ? 'night-sky is-demo' : 'night-sky'}>
      <Sky />
      {demo.active ? <DemoBar /> : null}
      <header class="app-header">
        <h1 tabIndex={-1}>{t('app.title')}</h1>
        <div class="header-tools">
          {recovering || demo.active ? null : (
            <>
              <KeepCopy />
              <TrySample />
            </>
          )}
          <LangSwitch />
          <SoundSwitch />
        </div>
        <LiveRegion message={message} />
      </header>
      {recovering || demo.active ? null : (
        <div class="top-tools">
          <StorageNotice />
        </div>
      )}
      <main class="app-main">
        {recovering ? <Recovery /> : null}
        {!recovering && route === 'archive' ? <Archive /> : null}
        {recovering ? null : (
          <div hidden={route === 'archive'} class="house-view">
            <CreateForm />
            <House grownFloors={floors} corner={<CameraControls grownFloors={floors} />}>
              <WarmLamps grownFloors={floors} />
              <ResidentLayer grownFloors={floors} />
              <Lobby grownFloors={floors} />
              <CelebrationLayer grownFloors={floors} />
            </House>
            {selectedId ? <TaskCard key={selectedId} taskId={selectedId} /> : null}
          </div>
        )}
      </main>
      {recovering ? null : (
        <footer class="app-footer">
          <nav aria-label={t('footer.nav')}>
            <a class="footer-link" href={route === 'archive' ? '#/' : '#/archive'}>
              {t(route === 'archive' ? 'archive.close' : 'lobby.archive')}
            </a>
          </nav>
        </footer>
      )}
    </div>
  );
}

export interface AppProps {
  /** 测试时注入自己的 store（例如可注入写入失败的端口）。 */
  context?: AppContext;
  /** 页面级的声音控制器；缺省时放不了声音。 */
  sound?: SoundController;
}

export function App({ context, sound: given }: AppProps = {}) {
  const [real] = useState(() => context ?? createAppContext());
  const [sound] = useState(() => given ?? createSoundController({ engine: null }));
  useSoundLifecycle(sound);
  const [demoCtx, setDemoCtx] = useState<AppContext | null>(null);
  // 进入示例前的现场：只记 hash 与滚动位置；真实 store 与 ui 本来就原样留在 real 里。
  const before = useRef<HashSnapshot | null>(null);
  const returnFocus = useRef(false);
  const announcement = useRef<CopyKey | ''>('');

  const enter = useCallback(() => {
    if (before.current || real.store.session.getState().mode === 'recovery') return;
    // 先处理已排队的保存，再整个暂停：示例期间真实 store 不收动作、不写任何键。
    real.store.freeze();
    before.current = takeSnapshot();
    writeHash('#/');
    announcement.current = 'demo.live.enter';
    setDemoCtx(createDemoContext(real));
  }, [real]);

  const exit = useCallback(() => {
    const snap = before.current;
    if (!snap) return;
    before.current = null;
    // 示例里若停在纪念册，要把 hash 还成进入前的样子，真实页面才不会停在示例的页面上。
    writeHash(snap.hash);
    real.store.thaw();
    returnFocus.current = true;
    announcement.current = 'demo.live.exit';
    setDemoCtx(null);
    if (typeof window.scrollTo === 'function') window.scrollTo(snap.scrollX, snap.scrollY);
  }, [real]);

  const control = useMemo<DemoControl>(
    () => ({
      active: demoCtx !== null,
      enter,
      exit,
      returning: () => returnFocus.current,
      endReturn() {
        returnFocus.current = false;
      },
      takeAnnouncement() {
        const v = announcement.current;
        announcement.current = '';
        return v;
      },
    }),
    [demoCtx, enter, exit],
  );

  return (
    <SoundContext.Provider value={sound}>
      <DemoControlContext.Provider value={control}>
        <StoreContext.Provider key={demoCtx ? 'demo' : 'real'} value={demoCtx ?? real}>
          <LanguageScope><Shell /></LanguageScope>
        </StoreContext.Provider>
      </DemoControlContext.Provider>
    </SoundContext.Provider>
  );
}
