import Image from "next/image";
import Link from "next/link";
export function SiteFooter() {
return <footer className="site-footer"><div className="container"><div className="footer-grid">
    <div><Link href="/" className="brand"><Image src="/brand/orbital-bean.webp" width={48} height={48} alt="" /><span>ET LINK<small>ETHIOPIAN COFFEE TRADE</small></span></Link><p className="footer-tagline">Ethiopian Coffee.<br />Connected Globally.</p><p>Addis Ababa, Ethiopia</p></div>
    <div><h2>Explore ET Link</h2><Link href="/about">About ET Link</Link><Link href="/how-it-works">How it works</Link><Link href="/coffee-origins">Coffee origins</Link><Link href="/auth/login">Sign in</Link><Link href="/auth/register">Create a business account</Link></div>
    <div><h2>Start a conversation</h2><Link href="/for-buyers">Buy Ethiopian Coffee ↗</Link><Link href="/for-suppliers">Supply Ethiopian Coffee ↗</Link><a href="mailto:etlinkcoffee@gmail.com">etlinkcoffee@gmail.com</a><a href="tel:+251993891528">+251 993 891 528</a><a href="https://wa.me/251926329275">WhatsApp ↗</a></div>
  </div><div className="footer-bottom"><p>© {new Date().getFullYear()} ET Link Coffee</p><p>Private opportunities. Thoughtful connections.</p><Link href="/contact">etlinkcoffee.com</Link></div></div></footer>;
}
