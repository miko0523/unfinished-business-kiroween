import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { canHoldFocus, settleFocus } from './focusFallback';

export interface DialogProps {
  /** 标题元素的 id，用作可访问名称。 */
  labelledBy: string;
  onClose(): void;
  /** 关闭后焦点去哪里；缺省回到打开前的控件。给出的元素若为空（例如打开前的控件已经消失），同样退回缺省；再不行，交给创建框或页面标题。 */
  restoreFocus?(): HTMLElement | null | undefined;
  children: ComponentChildren;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * 模态对话框：打开时焦点移入首个控件，Tab 在其中循环，Esc 关闭，关闭后焦点回到打开前的控件。
 * 优先用原生 <dialog>.showModal()，不支持时退回 open 属性。
 */
export function Dialog({ labelledBy, onClose, restoreFocus, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const restoreRef = useRef(restoreFocus);
  restoreRef.current = restoreFocus;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const previous = document.activeElement as HTMLElement | null;
    try {
      if (typeof el.showModal === 'function') el.showModal();
      else el.setAttribute('open', '');
    } catch {
      el.setAttribute('open', '');
    }
    el.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => {
      try {
        if (typeof el.close === 'function') el.close();
      } catch {
        /* 已经关了 */
      }
      const target = restoreRef.current?.();
      if (canHoldFocus(target)) target.focus({ preventScroll: true });
      else if (canHoldFocus(previous)) previous.focus();
      // 控件可能在这一轮渲染里才被移除（例如确认完成后它所在的详情卡消失）：提交之后再核对一次。
      settleFocus();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeRef.current();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !ref.current?.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !ref.current?.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={ref}
      class="dialog"
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        e.preventDefault();
        closeRef.current();
      }}
    >
      {children}
    </dialog>
  );
}
