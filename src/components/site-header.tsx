import Link from "next/link";

const NAV_LINKS = [
  { href: "/#features", label: "Возможности" },
  { href: "/day-5", label: "Day 5" },
  { href: "/day-6", label: "Day 6" },
  { href: "/day-7", label: "Day 7" },
  { href: "/day-8", label: "Day 8" },
  { href: "/day-9", label: "Day 9" },
  { href: "/day-10", label: "Day 10" },
];

export function SiteHeader() {
  return (
    <header className="flex h-16 items-center justify-between">
      <Link href="/" className="flex min-h-11 items-center gap-2 font-semibold tracking-tight">
        <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-accent-deep text-sm font-bold text-white">
          F
        </span>
        Flash Chat
      </Link>
      <nav className="flex max-w-[68vw] items-center gap-2 overflow-x-auto text-sm text-muted sm:gap-4 lg:gap-6">
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`${link.href === "/#features" ? "hidden md:inline-flex" : "inline-flex"} min-h-11 min-w-11 items-center justify-center transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
