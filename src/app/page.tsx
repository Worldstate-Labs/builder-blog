import Link from "next/link";
import { redirect } from "next/navigation";
import { Rss, Search, Terminal } from "lucide-react";
import { I18nText } from "@/components/I18nProvider";
import { PublicHeader } from "@/components/PublicHeader";
import { getCurrentSession } from "@/lib/auth";

const KINDS = ["x", "blog", "youtube", "podcast", "website"] as const;

export default async function Home() {
  const session = await getCurrentSession();
  if (session) redirect("/dashboard");

  return (
    <>
      <PublicHeader current="home" />
      <main className="lp">
        <header className="lp-hero">
          <div className="lp-hero-bg" aria-hidden="true" />
          <div className="lp-wrap lp-hero-inner">
            <div className="lp-hero-kicker">
              <I18nText id="home.kicker" />
            </div>
            <h1 className="lp-hero-title">
              <I18nText id="home.heroTitle1" />
              <br />
              <I18nText id="home.heroTitle2" />
            </h1>
            <p className="lp-hero-copy">
              <I18nText id="home.heroCopy" />
            </p>
            <div className="lp-hero-actions">
              <Link className="fb-btn dark lp-btn-lg" href="/login">
                <I18nText id="home.startBrief" />
              </Link>
              <a className="fb-btn light lp-btn-lg" href="#film">
                <I18nText id="home.watchFilm" />
              </a>
            </div>
            <div className="lp-kinds">
              <span className="lp-kinds-label">
                <I18nText id="home.worksWith" />
              </span>
              {KINDS.map((kind) => (
                <span className="fb-kind-pill" key={kind}>
                  {kind}
                </span>
              ))}
            </div>
          </div>
        </header>

        <section className="lp-film" id="film">
          <div className="lp-wrap">
            <div className="lp-film-head">
              <span className="fb-section-label">
                <I18nText id="home.filmLabel" />
              </span>
              <span className="lp-film-note">
                <I18nText id="home.filmNote" />
              </span>
            </div>
            <div className="lp-film-frame">
              <div className="lp-film-chrome" aria-hidden="true">
                <span className="lp-film-dot" />
                <span className="lp-film-dot" />
                <span className="lp-film-dot" />
                <span className="lp-film-chrome-title">
                  followbrief.worldstatelabs.com — everyone you follow, one brief
                </span>
              </div>
              <div className="lp-film-body">
                <video
                  src="/followbrief-promo.mp4"
                  aria-label="FollowBrief promo film"
                  controls
                  playsInline
                  preload="metadata"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="lp-section" id="how-it-works">
          <div className="lp-wrap">
            <span className="fb-section-label">
              <I18nText id="home.whatItDoes" />
            </span>
            <div className="lp-section-head">
              <h2 className="lp-section-title">
                <I18nText id="home.loopTitle" />
              </h2>
              <span className="lp-section-note">
                <I18nText id="home.loopNote" />
              </span>
            </div>
            <div className="lp-steps">
              <article className="lp-step">
                <span className="lp-step-icon">
                  <Rss aria-hidden="true" />
                </span>
                <h3 className="lp-step-title">
                  <I18nText id="home.step1Title" />
                </h3>
                <p className="lp-step-copy">
                  <I18nText id="home.step1Copy" />
                </p>
                <span className="lp-step-tag">
                  <I18nText id="home.step1Tag" />
                </span>
              </article>
              <article className="lp-step">
                <span className="lp-step-icon">
                  <Terminal aria-hidden="true" />
                </span>
                <h3 className="lp-step-title">
                  <I18nText id="home.step2Title" />
                </h3>
                <p className="lp-step-copy">
                  <I18nText id="home.step2Copy" />
                </p>
                <span className="lp-step-tag">
                  <I18nText id="home.step2Tag" />
                </span>
              </article>
              <article className="lp-step">
                <span className="lp-step-icon">
                  <Search aria-hidden="true" />
                </span>
                <h3 className="lp-step-title">
                  <I18nText id="home.step3Title" />
                </h3>
                <p className="lp-step-copy">
                  <I18nText id="home.step3Copy" />
                </p>
                <span className="lp-step-tag">
                  <I18nText id="home.step3Tag" />
                </span>
              </article>
            </div>
          </div>
        </section>

        <section className="lp-cta">
          <div className="lp-wrap">
            <div className="lp-cta-brand">
              <span className="lp-cta-mark">F</span>
              <span className="lp-cta-name">FollowBrief</span>
            </div>
            <div className="lp-cta-tag">
              <I18nText id="home.ctaTagline" />
            </div>
            <div>
              <Link className="lp-cta-btn" href="/login">
                <I18nText id="home.startBrief" />
              </Link>
            </div>
            <div className="lp-cta-url">followbrief.worldstatelabs.com</div>
          </div>
        </section>

        <div className="lp-wrap">
          <footer className="lp-footer">
            <span>© 2026 FollowBrief</span>
            <span className="lp-footer-links">
              <a href="#how-it-works">
                <I18nText id="home.whatItDoes" />
              </a>
              <a href="#film">
                <I18nText id="home.filmLabel" />
              </a>
            </span>
          </footer>
        </div>
      </main>
    </>
  );
}
