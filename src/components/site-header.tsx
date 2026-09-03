import Link from "next/link";

const NAV_LINKS = [
  { href: "/#features", label: "Возможности" },
  { href: "/day-3", label: "Day 3" },
];

export function SiteHeader() {
  return (
    <header className="flex h-16 items-center justify-between">
      <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
        <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-accent-deep text-sm font-bold text-white">
          F
        </span>
        Flash Chat
      </Link>
      <nav className="flex items-center gap-6 text-sm text-muted">
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="transition-colors hover:text-foreground"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
