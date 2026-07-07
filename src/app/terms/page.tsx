import { PublicHeader } from "@/components/PublicHeader";
import { getCurrentSession } from "@/lib/auth";
import { termsBlocks, termsIntro } from "@/lib/legal-pages";

export default async function TermsPage() {
  const session = await getCurrentSession();

  return (
    <>
      <PublicHeader current="terms" session={session} />
      <main className="fb-landing-grid min-h-screen">
        <section className="fb-public-section">
          <div>
            <span className="fb-section-label">Terms</span>
            <h1 className="fb-public-title">FollowBrief Terms of Service</h1>
            <p className="fb-public-copy">{termsIntro}</p>
          </div>

          <div className="fb-public-feature-grid">
            {termsBlocks.map((block) => (
              <TermsBlock key={block.title} title={block.title} copy={block.copy} />
            ))}
          </div>
        </section>
      </main>
    </>
  );
}

function TermsBlock({ title, copy }: { title: string; copy: string }) {
  return (
    <article className="fb-signal">
      <span className="fb-signal-dot" />
      <div className="fb-signal-copy">
        <h2 className="fb-signal-title">{title}</h2>
        <p className="fb-signal-desc">{copy}</p>
      </div>
    </article>
  );
}
