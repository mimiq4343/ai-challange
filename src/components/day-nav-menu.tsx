"use client";

import { CaretDownIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type FocusEvent } from "react";

const FIRST_DAY = 5;
const LAST_DAY = 21;
const DAY_LINKS = Array.from({ length: LAST_DAY - FIRST_DAY + 1 }, (_, index) => {
  const day = FIRST_DAY + index;
  return { href: `/day-${day}`, label: `Day ${day}` };
});

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function DayNavMenu() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const current = DAY_LINKS.find((link) => link.href === pathname);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const closeWhenFocusLeaves = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative" onBlur={closeWhenFocusLeaves}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        aria-label={`${current?.label ?? "Дни"}: выбор дня челленджа`}
        className={`flex min-h-11 min-w-11 cursor-pointer items-center gap-1.5 rounded-xl border border-line px-3 text-foreground transition-colors hover:border-accent/40 ${FOCUS_RING}`}
      >
        {current?.label ?? "Дни"}
        <CaretDownIcon size={14} aria-hidden className={`text-muted transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute right-0 top-full z-50 mt-2 w-[min(18rem,calc(100vw-1.5rem))] rounded-2xl border border-line bg-surface p-2 shadow-[0_24px_80px_rgba(3,5,16,0.65)]"
      >
        <ul className="grid grid-cols-3 gap-1">
          {DAY_LINKS.map((link) => {
            const active = link.href === pathname;
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={`flex min-h-11 items-center justify-center rounded-xl text-sm transition-colors ${
                    active ? "bg-accent/15 font-medium text-accent" : "text-muted hover:bg-accent/10 hover:text-foreground"
                  } ${FOCUS_RING}`}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
