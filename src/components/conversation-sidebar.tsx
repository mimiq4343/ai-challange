import { useEffect, useRef, useState } from "react";
import { DatabaseIcon, PlusIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import type { ConversationSummary } from "@/lib/conversation-types";

type ConversationSidebarProps = {
  conversations: ConversationSummary[];
  activeId: string | null;
  disabled: boolean;
  open: boolean;
  onClose: () => void;
  onCreate: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
};

export function ConversationSidebar({
  conversations,
  activeId,
  disabled,
  open,
  onClose,
  onCreate,
  onSelect,
  onDelete,
}: ConversationSidebarProps) {
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open || window.matchMedia("(min-width: 1024px)").matches) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = sidebarRef.current;
    const controls = () => Array.from(panel?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex='0']") ?? []);
    controls()[0]?.focus();
    function trapFocus(event: KeyboardEvent) {
      if (event.key !== "Tab" || deleteTarget || window.matchMedia("(min-width: 1024px)").matches) return;
      const targets = controls();
      const first = targets[0];
      const last = targets.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", trapFocus);
    return () => { document.removeEventListener("keydown", trapFocus); if (previous?.isConnected) previous.focus(); };
  }, [open, deleteTarget]);

  useEffect(() => {
    if (deleteTarget) cancelRef.current?.focus();
  }, [deleteTarget]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (deleteTarget) setDeleteTarget(null);
      else if (open) onClose();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteTarget, onClose, open]);

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(deleteTarget.id);
      setDeleteTarget(null);
    } catch (error) {
      setDeleteError(error instanceof TypeError
        ? "Не удалось удалить диалог. Проверьте соединение и попробуйте ещё раз."
        : error instanceof Error ? error.message : "Не удалось удалить диалог. Попробуйте ещё раз.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Закрыть список диалогов"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-[2px] lg:hidden"
        />
      )}

      <aside
        ref={sidebarRef}
        id="conversation-sidebar"
        aria-label="Список диалогов"
        className={`fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] flex-col border-r border-line bg-surface transition-transform duration-200 motion-reduce:transition-none lg:visible lg:static lg:z-auto lg:max-w-none lg:translate-x-0 ${open ? "visible translate-x-0" : "invisible -translate-x-full"}`}
      >
        <div className="flex items-center gap-2 border-b border-line p-3">
          <button
            type="button"
            disabled={disabled}
            onClick={onCreate}
            className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent-deep px-3 text-sm font-semibold text-white transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
          >
            <PlusIcon size={17} weight="bold" aria-hidden />
            Новый диалог
          </button>
          <button
            type="button"
            aria-label="Закрыть список диалогов"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-line text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:hidden"
          >
            <XIcon size={18} aria-hidden />
          </button>
        </div>

        <div className="chat-scroll flex-1 overflow-y-auto p-2">
          <p className="px-2 pb-2 pt-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
            Последние диалоги
          </p>
          {conversations.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm leading-relaxed text-muted">
              История пока пуста.
              <br />
              Начните новый диалог.
            </p>
          ) : (
            <ul className="space-y-1">
              {conversations.map((conversation) => {
                const active = conversation.id === activeId;
                return (
                  <li
                    key={conversation.id}
                    className={`group flex min-h-11 items-center rounded-xl border transition-colors ${active ? "border-accent/25 bg-accent/10" : "border-transparent hover:bg-white/[0.035]"}`}
                  >
                    <button
                      type="button"
                      disabled={disabled}
                      aria-current={active ? "page" : undefined}
                      onClick={() => {
                        onSelect(conversation.id);
                        onClose();
                      }}
                      className="min-h-11 min-w-0 flex-1 cursor-pointer truncate px-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {conversation.title}
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={`Удалить диалог «${conversation.title}»`}
                      onClick={() => { setDeleteError(null); setDeleteTarget(conversation); }}
                      className={`flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted transition-colors hover:bg-red-400/10 hover:text-red-300 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 ${active ? "opacity-100" : "opacity-70"}`}
                    >
                      <TrashIcon size={16} aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex min-h-12 items-center gap-2 border-t border-line px-4 text-xs text-muted">
          <DatabaseIcon size={15} className="text-accent" aria-hidden />
          SQLite · автосохранение
        </div>
      </aside>

      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]"
        >
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-[0_24px_80px_rgba(3,5,16,0.65)]">
            <h2 id="delete-dialog-title" className="font-semibold">
              Удалить диалог?
            </h2>
            <p className="mt-2 break-words text-sm leading-relaxed text-muted">
              «{deleteTarget.title}» и все его сообщения будут удалены без восстановления.
            </p>
            {deleteError && <p role="alert" className="mt-3 rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs leading-relaxed text-red-200">{deleteError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                ref={cancelRef}
                type="button"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
                className="min-h-11 cursor-pointer rounded-xl border border-line px-4 text-sm font-medium transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void confirmDelete()}
                className="min-h-11 cursor-pointer rounded-xl bg-red-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-300 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {deleting ? "Удаление…" : "Удалить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
