import { useParams, Link, Navigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { gsap, useGsapContext, revealTextOnScroll, prefersReducedMotion } from '../../animations/gsapUtils.js';
import { AvatarInitials, BlogPhoto } from '../../components/marketing/illustrations.jsx';
import { BLOG_POSTS, getPostBySlug } from '../../data/blog.js';

const dateLabel = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export default function BlogPost() {
  const { slug } = useParams();
  const post = getPostBySlug(slug);

  useGsapContext(() => {
    if (!post || prefersReducedMotion()) return;
    gsap.from('[data-post-in]', { opacity: 0, y: 16, duration: 0.55, stagger: 0.07, ease: 'power2.out' });
    revealTextOnScroll(document.querySelectorAll('[data-text-reveal]'));
  }, [post]);

  if (!post) return <Navigate to="/blog" replace />;

  const more = BLOG_POSTS.filter((p) => p.slug !== post.slug).slice(0, 2);

  return (
    <article>
      <section className={`bg-gradient-to-br px-5 pb-16 pt-16 md:pt-24 ${post.tone === 'signal' ? 'from-signal/15 to-transparent' : 'from-pulse/15 to-transparent'}`}>
        <div className="mx-auto max-w-2xl">
          <Link to="/blog" data-post-in className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
            <ArrowLeft className="h-4 w-4" /> All posts
          </Link>
          <p data-post-in className="mt-6 text-sm font-medium uppercase tracking-wide text-pulse-deep">{post.category}</p>
          {/* key={post.slug}: forces a fresh DOM node per post so the word-split
              markup revealTextOnScroll injects (raw innerHTML, outside React's
              tracking) never collides with React reconciling stale span
              children against a plain-text child on in-place navigation
              between posts. */}
          <h1 key={post.slug} data-text-reveal className="mt-2 font-display text-title font-bold sm:text-display">{post.title}</h1>
          <div data-post-in className="mt-6 flex items-center gap-3">
            <AvatarInitials name={post.author} tone={post.tone} />
            <div className="text-sm">
              <p className="font-medium">{post.author}</p>
              <p className="text-ink-muted">{post.role} · {dateLabel(post.date)} · {post.readMins} min read</p>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-4xl px-5">
        <div data-post-in className="card overflow-hidden">
          <BlogPhoto seed={post.slug} tone={post.tone} w={1200} h={630} alt=""
                     className="h-56 w-full sm:h-72" />
        </div>
      </div>

      <section className="mx-auto max-w-2xl px-5 py-16">
        <div data-post-in className="space-y-6">
          {post.content.map((block, i) => {
            if (block.type === 'h2') return <h2 key={i} className="pt-2 font-display text-xl font-semibold">{block.text}</h2>;
            if (block.type === 'quote') {
              return (
                <blockquote key={i} className="border-l-2 border-pulse pl-5 text-lg italic leading-relaxed text-ink-soft">
                  {block.text}
                </blockquote>
              );
            }
            return <p key={i} className="text-[17px] leading-relaxed text-ink-soft">{block.text}</p>;
          })}
        </div>
      </section>

      {more.length > 0 && (
        <section className="border-t border-line bg-paper-sunk">
          <div className="mx-auto max-w-4xl px-5 py-16">
            <h2 data-text-reveal className="font-display text-lg font-semibold">Keep reading</h2>
            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              {more.map((p) => (
                <Link key={p.slug} to={`/blog/${p.slug}`}
                      className="card group overflow-hidden transition hover:-translate-y-1 hover:shadow-lift">
                  <BlogPhoto seed={p.slug} tone={p.tone} w={500} h={220} alt=""
                             className="h-28 transition-transform duration-500 group-hover:scale-105" />
                  <div className="p-5">
                    <p className="text-xs font-medium uppercase tracking-wide text-pulse-deep">{p.category}</p>
                    <h3 className="mt-1.5 font-display text-[15px] font-semibold group-hover:text-pulse-deep">{p.title}</h3>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}
    </article>
  );
}
