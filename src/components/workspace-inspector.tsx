"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { BrainIcon, XIcon } from "@phosphor-icons/react";

const DESKTOP_PREFERENCE_KEY = "flash-chat.inspector.desktop-open";
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

type WorkspaceInspectorProps = {
  children: ReactNode;
  inspector: ReactNode;
  label: string;
};

function subscribeBreakpoint(onChange: () => void) {
  const breakpoint = window.matchMedia("(min-width: 1280px)");
  breakpoint.addEventListener("change", onChange);
  return () => breakpoint.removeEventListener("change", onChange);
}

function subscribePreference(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function readDesktopPreference() {
  try {
    return localStorage.getItem(DESKTOP_PREFERENCE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function WorkspaceInspector({ children, inspector, label }: WorkspaceInspectorProps) {
  const isDesktop = useSyncExternalStore(
    subscribeBreakpoint,
    () => window.matchMedia("(min-width: 1280px)").matches,
    () => false,
  );
  const savedDesktopOpen = useSyncExternalStore(subscribePreference, readDesktopPreference, () => true);
  const [desktopOverride, setDesktopOverride] = useState<boolean | null>(null);
  const desktopOpen = desktopOverride ?? savedDesktopOpen;
  const [mobileOpen, setMobileOpen] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const visible = isDesktop ? desktopOpen : mobileOpen;
  const mobileModal = !isDesktop && mobileOpen;

  useEffect(() => {
    const breakpoint = window.matchMedia("(min-width: 1280px)");
    function updateBreakpoint() {
      setMobileOpen(false);
    }
    breakpoint.addEventListener("change", updateBreakpoint);
    return () => breakpoint.removeEventListener("change", updateBreakpoint);
  }, []);

  useEffect(() => {
    if (!mobileModal || !sheetRef.current) return;
    const inertElements: Array<{ element: HTMLElement; previous: boolean }> = [];
    let branch: HTMLElement = sheetRef.current;
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          inertElements.push({ element: sibling, previous: sibling.inert });
          sibling.inert = true;
        }
      }
      branch = branch.parentElement;
      if (branch === document.body) break;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const trigger = triggerRef.current;
    return () => {
      for (const { element, previous } of inertElements) element.inert = previous;
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, [mobileModal]);

  function setDesktopVisibility(open: boolean) {
    setDesktopOverride(open);
    try {
      localStorage.setItem(DESKTOP_PREFERENCE_KEY, String(open));
    } catch {
      // Скрытие панели не зависит от доступности localStorage.
    }
  }

  function closeInspector() {
    if (isDesktop) {
      setDesktopVisibility(false);
      triggerRef.current?.focus();
    } else {
      setMobileOpen(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!mobileModal) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeInspector();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-2">
      <div className="flex shrink-0 justify-end">
        <button
          ref={triggerRef}
          type="button"
          aria-controls={panelId}
          aria-expanded={visible}
          onClick={() => {
            if (isDesktop) setDesktopVisibility(!desktopOpen);
            else setMobileOpen(true);
          }}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface px-3 text-xs font-medium text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <BrainIcon size={19} weight="bold" aria-hidden />
          {isDesktop ? (desktopOpen ? "Скрыть панель" : "Показать панель") : "Открыть панель"}
        </button>
      </div>
      <div className={`grid min-h-0 min-w-0 flex-1 gap-3 ${isDesktop && desktopOpen ? "grid-cols-[minmax(0,1fr)_23rem]" : "grid-cols-[minmax(0,1fr)]"}`}>
        <div className="min-h-0 min-w-0">{children}</div>
        <aside
          ref={sheetRef}
          id={panelId}
          aria-label={label}
          aria-modal={mobileModal || undefined}
          role={mobileModal ? "dialog" : undefined}
          onKeyDown={handleKeyDown}
          className={`${visible ? "flex" : "hidden"} ${mobileModal ? "fixed inset-0 z-40 bg-black/70 p-2 pt-[8dvh]" : "min-h-0 min-w-0"}`}
        >
          <div className="flex min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_80px_rgba(3,5,16,0.55)]">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-2">
              <h2 className="text-sm font-semibold">Панель агента</h2>
              <button
                ref={closeRef}
                type="button"
                onClick={closeInspector}
                aria-label={isDesktop ? "Свернуть панель агента" : "Закрыть панель"}
                className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-line text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <XIcon size={18} aria-hidden />
              </button>
            </header>
            <div className="chat-scroll min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
              {inspector}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
