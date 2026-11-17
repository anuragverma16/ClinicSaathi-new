import { Link } from 'react-router-dom';
import { gsap, useGsapContext, revealOnScroll, revealTextOnScroll, prefersReducedMotion } from '../../animations/gsapUtils.js';
import { AvatarInitials, BlogPhoto } from '../../components/marketing/illustrations.jsx';
import { BLOG_POSTS } from '../../data/blog.js';

const dateLabel = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export default function Blog() {
  useGsapContext(() => {
    if (prefersReducedMotion()) return;
    gsap.from('[data-hero-in]', { opacity: 0, y: 20, duration: 0.6, stagger: 0.08, ease: 'power2.out' });
    revealTextOnScroll(document.querySelectorAll('[data-text-reveal]'));
    revealOnScroll(gsap.utils.toArray('[data-post-card]'), { y: 24, stagger: 0.08 });
  }, []);

  const [featured, ...rest] = BLOG_POSTS;

  return (
    <div>
      <section className="px-5 pb-4 pt-16 text-center md:pt-24">
        <p data-hero-in className="text-sm font-medium uppercase tracking-wide text-pulse-deep">Blog</p>
        <h1 data-text-reveal className="mt-3 font-display text-title font-bold sm:text-display">Notes on running a better clinic</h1>
        <p data-hero-in className="mx-auto mt-4 max-w-lg text-lg text-ink-soft">
          Operations, billing and patient care — what actually moves the needle, written by the people building the product.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16">
        <Link to={`/blog/${featured.slug}`} data-post-card
              className={`card group grid overflow-hidden transition hover:-translate-y-1 hover:shadow-lift md:grid-cols-[1.1fr_1fr]`}>
          <div className="relative flex min-h-[220px] items-end p-8">
            <div className="absolute inset-0">
              <BlogPhoto seed={featured.slug} tone={featured.tone} w={900} h={520} alt="" className="h-full w-full" />
            </div>
            <span className="relative rounded-full bg-surface/85 px-3 py-1 text-xs font-medium text-ink">{featured.category}</span>
          </div>
          <div className="flex flex-col justify-center p-8">
            <h2 className="font-display text-2xl font-semibold leading-snug group-hover:text-pulse-deep">{featured.title}</h2>
            <p className="mt-3 text-ink-soft">{featured.excerpt}</p>
            <div className="mt-5 flex items-center gap-3">
              <AvatarInitials name={featured.author} tone={featured.tone} />
              <div className="text-sm">
                <p className="font-medium">{featured.author}</p>
                <p className="text-ink-muted">{dateLabel(featured.date)} · {featured.readMins} min read</p>
              </div>
            </div>
          </div>
        </Link>

        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {rest.map((post) => (
            <Link key={post.slug} to={`/blog/${post.slug}`} data-post-card
                  className="card group flex flex-col overflow-hidden transition hover:-translate-y-1 hover:shadow-lift">
              <BlogPhoto seed={post.slug} tone={post.tone} w={500} h={280} alt=""
                         className="h-36 transition-transform duration-500 group-hover:scale-105" />
              <div className="flex flex-1 flex-col p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-pulse-deep">{post.category}</p>
                <h3 className="mt-2 font-display text-[17px] font-semibold leading-snug group-hover:text-pulse-deep">{post.title}</h3>
                <p className="mt-2 line-clamp-2 flex-1 text-sm text-ink-soft">{post.excerpt}</p>
                <div className="mt-4 flex items-center gap-2.5">
                  <AvatarInitials name={post.author} tone={post.tone} className="h-7 w-7 text-[11px]" />
                  <p className="text-xs text-ink-muted">{dateLabel(post.date)} · {post.readMins} min</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
