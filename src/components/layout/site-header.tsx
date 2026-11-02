import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-forest/15 bg-ivory">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-5 px-6 py-6 sm:px-10">
        <Link href="/" aria-label="ET Link Coffee home" className="group flex items-center gap-3">
          <span aria-hidden="true" className="grid size-11 place-items-center rounded-full border border-forest font-display text-xl text-forest">ET</span>
          <span className="text-sm font-semibold tracking-[0.18em] text-deep-green">ET LINK <span className="block text-[0.65rem] font-normal tracking-[0.32em]">COFFEE</span></span>
        </Link>
        <nav aria-label="Main navigation" className="flex flex-wrap gap-6 text-sm font-medium text-forest">
          <Link className="transition-colors hover:text-deep-green" href="/#our-purpose">Our purpose</Link>
          <Link className="transition-colors hover:text-deep-green" href="/#our-foundation">Our foundation</Link>
        </nav>
      </div>
    </header>
  );
}
