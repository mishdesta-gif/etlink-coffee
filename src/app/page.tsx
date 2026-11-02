const principles = [
  { number: "01", title: "Rooted in origin", description: "Ethiopia’s coffee heritage is the starting point for everything we are building." },
  { number: "02", title: "Built for connection", description: "Our purpose is to bring people and businesses in the coffee community closer together." },
  { number: "03", title: "Growing with intention", description: "We are laying the groundwork for a thoughtful approach to coffee trade." },
];

export default function HomePage() {
  return (
    <>
      <section aria-labelledby="hero-title" className="relative overflow-hidden bg-forest text-ivory">
        <div aria-hidden="true" className="pointer-events-none absolute -top-24 -right-28 size-96 rounded-full border border-gold/30 sm:size-[36rem]" />
        <div aria-hidden="true" className="pointer-events-none absolute right-0 bottom-[-15rem] size-96 rounded-full border border-gold/20" />
        <div className="relative mx-auto max-w-7xl px-6 py-24 sm:px-10 sm:py-32 lg:py-40">
          <p className="text-xs font-medium tracking-[0.24em] text-gold uppercase">From Ethiopia. For connection.</p>
          <h1 id="hero-title" className="mt-7 max-w-4xl font-display text-5xl leading-[1.1] sm:text-7xl lg:text-8xl">Great coffee begins<br className="hidden sm:block" /> with strong roots.</h1>
          <p className="mt-8 max-w-xl text-base leading-8 text-ivory/85 sm:text-lg">We’re building ET Link Coffee to connect Ethiopian coffee with the people and businesses who value its origins.</p>
          <a href="#our-purpose" className="mt-10 inline-flex items-center gap-6 rounded-sm bg-gold px-6 py-4 text-sm font-semibold text-deep-green transition-colors hover:bg-ivory">Discover our purpose <span aria-hidden="true">↗</span></a>
          <p className="mt-10 text-xs tracking-wider text-ivory/70">Our journey is just beginning. Platform in development.</p>
        </div>
      </section>
      <section id="our-purpose" aria-labelledby="purpose-title" className="mx-auto grid max-w-7xl gap-8 px-6 py-20 sm:px-10 sm:py-28 md:grid-cols-2 md:gap-16">
        <p className="text-xs font-semibold tracking-[0.22em] text-forest uppercase">Our purpose</p>
        <div>
          <h2 id="purpose-title" className="font-display text-4xl leading-tight sm:text-5xl">An enduring heritage.<br />A new connection.</h2>
          <p className="mt-6 max-w-xl leading-8 text-deep-green/80">Coffee is a shared language, rooted in place and carried through generations. ET Link Coffee is taking its first steps toward a platform for Ethiopian coffee trade and business matching.</p>
        </div>
      </section>
      <section id="our-foundation" aria-labelledby="foundation-title" className="border-t border-forest/20">
        <div className="mx-auto max-w-7xl px-6 py-20 sm:px-10">
          <h2 id="foundation-title" className="font-display text-3xl sm:text-4xl">The foundation we’re building on</h2>
          <div className="mt-10 grid gap-10 md:grid-cols-3">
            {principles.map((principle) => (
              <article key={principle.number} className="border-t border-forest/25 pt-6">
                <span className="text-sm font-medium text-forest">{principle.number}</span>
                <h3 className="mt-5 font-display text-2xl">{principle.title}</h3>
                <p className="mt-3 max-w-sm text-sm leading-7 text-deep-green/80">{principle.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
