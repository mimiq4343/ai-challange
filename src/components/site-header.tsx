import Link from "next/link";

import { DayNavMenu } from "@/components/day-nav-menu";

export function SiteHeader() {
  return (
    <header className="flex h-16 items-center justify-between">
      <Link href="/" className="flex min-h-11 items-center gap-2 font-semibold tracking-tight">
        <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-accent-deep text-sm font-bold text-white">
          F
        </span>
        Flash Chat
      </Link>
      <nav aria-label="Основная навигация" className="flex items-center gap-2 text-sm text-muted sm:gap-4">
        <Link
          href="/#features"
          className="hidden min-h-11 min-w-11 items-center justify-center transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:inline-flex"
        >
          Возможности
        </Link>
        <DayNavMenu />
      </nav>
    </header>
  );
}
