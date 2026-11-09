"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
const links = [["/", "Home"], ["/about", "About"], ["/how-it-works", "How it works"], ["/for-buyers", "For buyers"], ["/for-suppliers", "For suppliers"], ["/coffee-origins", "Coffee origins"], ["/contact", "Contact"]];
export function SiteHeader() {
  const pathname = usePathname(); const [open, setOpen] = useState(false); const button = useRef<HTMLButtonElement>(null);
  useEffect(() => { function close(e: KeyboardEvent) { if (e.key === "Escape" && open) { setOpen(false); button.current?.focus(); } } document.addEventListener("keydown", close); return () => document.removeEventListener("keydown", close); }, [open]);
  return <header className="site-header"><div className="container header-inner">
    <Link href="/" className="brand" aria-label="ET Link Coffee home" onClick={() => setOpen(false)}><Image src="/brand/orbital-bean.webp" alt="" width={52} height={52} preload /><span>ET LINK<small>ETHIOPIAN COFFEE TRADE</small></span></Link>
    <button ref={button} type="button" className="menu-toggle" aria-expanded={open} aria-controls="main-navigation" onClick={() => setOpen(!open)}>{open ? "Close ×" : "Menu ☰"}</button>
    <nav id="main-navigation" aria-label="Main navigation" className={open ? "navigation is-open" : "navigation"}>{links.map(([href, label]) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} onClick={() => setOpen(false)}>{label}</Link>)}</nav>
  </div></header>;
}