import { PublicHeader } from "@/components/PublicHeader";
import { getCurrentSession } from "@/lib/auth";
import { privacyBlocks, privacyIntro } from "@/lib/legal-pages";

export default async function PrivacyPage() {
  const session = await getCurrentSession();

  return (
    <>
      <PublicHeader current="privacy" session={session} />
      <main className="fb-landing-grid min-h-screen">
        <section className="fb-public-section">
          <div>
            <span className="fb-section-label">Privacy</span>
            <h1 className="fb-public-title">FollowBrief Privacy Policy</h1>
            <p className="fb-public-copy">{privacyIntro}</p>
          </div>

          <div className="fb-public-feature-grid">
            {privacyBlocks.map((block) => (
              <PolicyBlock key={block.title} title={block.title} copy={block.copy} />
            ))}
          </div>
        </section>
      </main>
    </>
  );
}

function PolicyBlock({ title, copy }: { title: string; copy: string }) {
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
