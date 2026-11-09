'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <section className="section"><div className="container"><h1>Workspace unavailable.</h1><p>Your records could not be loaded. Check the development connection or try again.</p><button className="button" onClick={reset}>Try again</button></div></section>;}
