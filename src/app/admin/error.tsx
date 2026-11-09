'use client';
export default function AdminError({reset}:{reset:()=>void}){return <section className="section"><div className="container"><h1>Staff service unavailable.</h1><p>Your authorized records could not be loaded. Check the database configuration and try again.</p><button className="button" onClick={reset}>Try again</button></div></section>;}
