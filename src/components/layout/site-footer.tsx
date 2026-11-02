import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="bg-deep-green text-ivory">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-end sm:justify-between sm:px-10">
        <div>
          <Link href="/" className="font-display text-2xl">ET Link Coffee</Link>
          <p className="mt-2 text-sm text-ivory/75">Ethiopian origins. Meaningful connections.</p>
        </div>
        <p className="max-w-xs text-sm text-ivory/75">A platform in development, rooted in Ethiopian coffee.</p>
      </div>
    </footer>
  );
}
