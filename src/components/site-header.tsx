const NAV_LINKS = [
  { href: "/#features", label: "Возможности" },
  { href: "/day-2", label: "Day 2" },
];

export function SiteHeader() {
  return (
    <header className="flex h-16 items-center justify-between">
      <a href="/" className="flex items-center gap-2 font-semibold tracking-tight">
        <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-accent-deep text-sm font-bold text-white">
          F
        </span>
        Flash Chat
      </a>
      <nav className="flex items-center gap-6 text-sm text-muted">
        {NAV_LINKS.map((link) => (
          <a key={link.href} href={link.href} className="transition-colors hover:text-foreground">
            {link.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
