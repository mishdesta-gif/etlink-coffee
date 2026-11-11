"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/auth/actions";

const links = [
  ["/", "Home"], ["/for-buyers", "For Buyers"], ["/for-suppliers", "For Suppliers"],
  ["/coffee-origins", "Coffee Origins"], ["/how-it-works", "How It Works"],
  ["/about", "About Us"], ["/contact", "Contact"],
];

export function SiteHeader({ account }: { account: { email: string | null } | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<"navigation" | "account" | null>(null);
  const navigationButton = useRef<HTMLButtonElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const header = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    function onEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(null);
      (open === "account" ? accountButton : navigationButton).current?.focus();
    }
    function onOutside(event: Event) {
      if (event.target instanceof Node && !header.current?.contains(event.target)) setOpen(null);
    }
    document.addEventListener("keydown", onEscape);
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("focusin", onOutside);
    return () => {
      document.removeEventListener("keydown", onEscape);
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("focusin", onOutside);
    };
  }, [open]);

  return <header ref={header} className="site-header"><div className="container header-inner">
    <Link href="/" className="brand" aria-label="ET Link Coffee home" onClick={() => setOpen(null)}><Image src="/brand/orbital-bean.webp" alt="" width={52} height={52} preload /><span>ET LINK<small>ETHIOPIAN COFFEE TRADE</small></span></Link>
    <button ref={navigationButton} type="button" className="menu-toggle header-control" aria-expanded={open === "navigation"} aria-controls="main-navigation" onClick={() => setOpen(open === "navigation" ? null : "navigation")}>Menu</button>
    <nav id="main-navigation" aria-label="Main navigation" className={open === "navigation" ? "navigation is-open" : "navigation"}>
      {links.map(([href, label]) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} onClick={() => setOpen(null)}>{label}</Link>)}
    </nav>
    <div className="header-account">
      {account ? <>
        <Link className="header-control header-primary" href="/portal" onClick={() => setOpen(null)}>My Workspace</Link>
        <button ref={accountButton} type="button" className="header-control header-account-toggle" aria-expanded={open === "account"} aria-controls="header-account-navigation" onClick={() => setOpen(open === "account" ? null : "account")}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <circle cx="12" cy="8" r="3.5" />
            <path d="M5 21v-2a7 7 0 0 1 14 0v2" strokeLinecap="round" />
          </svg>
          Account
        </button>
        <nav id="header-account-navigation" className="header-account-panel" aria-label="Account actions" hidden={open !== "account"}>
          {account.email && <div className="header-account-identity"><span>Signed in as</span><strong>{account.email}</strong></div>}
          <Link href="/portal" onClick={() => setOpen(null)}>My Workspace</Link>
          <Link href="/portal/security" onClick={() => setOpen(null)}>Account Security</Link>
          <Link href="/portal/invitations" onClick={() => setOpen(null)}>Invitations</Link>
          <form action={signOut} onSubmit={() => setOpen(null)}><button type="submit">Sign Out</button></form>
        </nav>
      </> : <>
        <Link className="header-control" href="/auth/login" onClick={() => setOpen(null)}>Sign In</Link>
        <Link className="header-control header-primary" href="/auth/register" onClick={() => setOpen(null)}>Register</Link>
      </>}
    </div>
  </div></header>;
}
