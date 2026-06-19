import { PublicHeader } from "@/components/PublicHeader";
import { getCurrentSession } from "@/lib/auth";

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
          <p className="fb-public-copy">
            These terms cover your use of FollowBrief, Local Agent access, Hub
            sharing, third-party sources, third-party APIs, and AI Digest output.
          </p>
        </div>

        <div className="fb-public-feature-grid">
          <TermsBlock
            title="Use of the service"
            copy="FollowBrief helps you follow sources, fetch updates, summarize source material, build AI Digest issues, and search your own workspace. You are responsible for the sources you add and the way you use generated output."
          />
          <TermsBlock
            title="Third-party content and APIs"
            copy="Sources and metadata may come from third-party sources and third-party APIs including GitHub, Google, Apple, X, YouTube, Product Hunt, RSS feeds, websites, and model providers. Their platform terms continue to apply to the content, accounts, and API access you connect."
          />
          <TermsBlock
            title="Source rights and retention"
            copy="Do not add private, paywalled, access-controlled, or platform-prohibited sources unless you have the right to fetch and summarize them. Local Agent may temporarily process raw source content, but durable raw retention depends on the source type; Hub sharing must not publish raw crawled content, full transcripts, raw API objects, or full third-party works."
          />
          <TermsBlock
            title="Local Agent and access keys"
            copy="Local Agent commands run on your machine using access keys you create in Settings. Keep each access key private, revoke keys you no longer use, and do not share keys, OAuth tokens, private digests, or private account data with others."
          />
          <TermsBlock
            title="AI Digest output"
            copy="AI Digest output is generated from source material and may be incomplete or wrong. Do not rely on it as legal, medical, financial, security, or other professional advice. Check original sources before acting on important information."
          />
          <TermsBlock
            title="Hub sharing"
            copy="If you share a source library or AI Digest collection to Hub, you grant FollowBrief permission to display the shared title, description, source names, source links, headline metadata, and public collection activity to other users until you remove it."
          />
          <TermsBlock
            title="Account controls"
            copy="You may export or delete your account data from Settings. Deleting your account removes active access to FollowBrief and may remove shared Hub entries tied to your account. Source owners can contact FollowBrief to request review or removal of source material."
          />
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
