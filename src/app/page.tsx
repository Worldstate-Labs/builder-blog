import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Newspaper, Radio, Rss, Search, Terminal } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { I18nText } from "@/components/I18nProvider";
import { PublicHeader } from "@/components/PublicHeader";
import { getCurrentSession } from "@/lib/auth";

export default async function Home() {
  const session = await getCurrentSession();
  if (session) redirect("/dashboard");

  return (
    <>
      <PublicHeader current="home" />
      <main className="fb-landing-grid min-h-screen">
      <section className="fb-public-section fb-public-hero">
        <div>
          <h1 className="fb-public-title">
            <I18nText id="home.heroTitle" />{" "}
            <span className="fb-public-title-break"><I18nText id="home.heroTitleBreak" /></span>
          </h1>
          <p className="fb-public-copy">
            <I18nText id="home.heroCopy" />
          </p>
          <div className="fb-public-actions">
            <Link className="fb-btn dark" href="/login">
              <I18nText id="common.signIn" />
            </Link>
            <a className="fb-btn light" href="#how-it-works">
              <I18nText id="home.seeWorkflow" />
            </a>
          </div>
          <div className="fb-public-flow" aria-label="FollowBrief workflow">
            {[
              ["login.followSources", "follow"],
              ["login.buildDigest", "digest"],
              ["login.search", "search"],
            ].map(([id, key]) => (
              <span className="fb-public-flow-step" key={key}>
                <I18nText id={id as "login.followSources" | "login.buildDigest" | "login.search"} />
              </span>
            ))}
          </div>
        </div>

        <div className="fb-hero-panel" aria-label="FollowBrief product demo">
          <div className="fb-product-preview-head">
            <div className="fb-product-preview-title-row">
              <BrandMark />
              <div>
                <div className="fb-product-preview-title"><I18nText id="home.previewTitle" /></div>
                <div className="fb-product-preview-kicker">
                  <I18nText id="home.previewKicker" />
                </div>
              </div>
            </div>
            <span className="fb-chip success" aria-label="Preview data">
              <Terminal aria-hidden="true" />
              <I18nText id="home.localAgent" />
            </span>
          </div>
          <div className="fb-product-demo" aria-hidden="true">
            <div className="fb-demo-sources">
              {[
                ["home.githubTrending", "github"],
                ["home.productHunt", "ph"],
                ["home.youtube", "youtube"],
                ["home.blogs", "blogs"],
              ].map(([id, key]) => (
                <span className="fb-demo-source" key={key}>
                  <I18nText id={id as "home.githubTrending" | "home.productHunt" | "home.youtube" | "home.blogs"} />
                </span>
              ))}
            </div>
            <div className="fb-demo-rail">
              <span className="fb-demo-pulse" />
            </div>
            <div className="fb-demo-card">
              <div className="fb-demo-card-head">
                <span><I18nText id="home.aiDigest" /></span>
                <span><I18nText id="home.cited" /></span>
              </div>
              <div className="fb-demo-line is-strong" />
              <div className="fb-demo-line" />
              <div className="fb-demo-line is-short" />
            </div>
            <div className="fb-demo-search">
              <Search aria-hidden="true" />
              <span><I18nText id="common.search" /></span>
            </div>
          </div>
          <div className="fb-product-preview-list">
            {[
              {
                title: "One cited AI Digest",
                titleId: "home.signalDigestTitle",
                detail: "Posts, videos, launches, and projects stay readable together.",
                detailId: "home.signalDigestDetail",
              },
              {
                title: "Sources stay visible",
                titleId: "home.signalSourcesTitle",
                detail: "Each summary keeps a path back to the original post.",
                detailId: "home.signalSourcesDetail",
              },
              {
                title: "Search later",
                titleId: "home.signalSearchTitle",
                detail: "Find sources, posts, and AI Digest issues when details matter.",
                detailId: "home.signalSearchDetail",
              },
            ].map((item) => (
              <article className="fb-signal" key={item.title}>
                <span className="fb-signal-dot" />
                <div className="fb-signal-copy">
                  <h2 className="fb-signal-title">
                    <I18nText id={item.titleId as "home.signalDigestTitle" | "home.signalSourcesTitle" | "home.signalSearchTitle"} />
                  </h2>
                  <p className="fb-signal-desc">
                    <I18nText id={item.detailId as "home.signalDigestDetail" | "home.signalSourcesDetail" | "home.signalSearchDetail"} />
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="how-it-works"
        className="fb-public-section fb-public-workflow"
      >
        <div className="fb-public-section-kicker-row">
          <span className="fb-section-label"><I18nText id="home.workflow" /></span>
          <span className="fb-public-section-note">
            <I18nText id="home.workflowNote" />
          </span>
        </div>
        <ol className="fb-public-step-list">
          {[
            {
              i: "01",
              icon: Rss,
              title: "Follow sources",
              titleId: "login.followSources",
              copy: "Start from shared source libraries, then add blogs, channels, feeds, GitHub Trending, and Product Hunt.",
              copyId: "home.stepFollowCopy",
            },
            {
              i: "02",
              icon: Terminal,
              title: "Build the AI Digest",
              titleId: "home.stepBuildTitle",
              copy: "The Local Agent fetches updates, summarizes source material, and assembles a cited AI Digest.",
              copyId: "home.stepBuildCopy",
            },
            {
              i: "03",
              icon: Search,
              title: "Search and revisit",
              titleId: "home.stepSearchTitle",
              copy: "Open originals and search sources, posts, and AI Digest issues later.",
              copyId: "home.stepSearchCopy",
            },
          ].map(({ i, icon: Icon, title, titleId, copyId }) => (
            <li key={title} className="fb-public-step-row">
              <span className="fb-public-step-index">{i}</span>
              <div className="fb-public-step-body">
                <div className="fb-public-step-title-row">
                  <Icon className="fb-public-step-icon" aria-hidden="true" />
                  <h2 className="fb-public-card-title">
                    <I18nText id={titleId as "login.followSources" | "home.stepBuildTitle" | "home.stepSearchTitle"} />
                  </h2>
                </div>
                <p className="fb-public-card-copy">
                  <I18nText id={copyId as "home.stepFollowCopy" | "home.stepBuildCopy" | "home.stepSearchCopy"} />
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="fb-public-section fb-public-workspace">
        <div>
          <span className="fb-section-label"><I18nText id="home.workspace" /></span>
          <h2 className="fb-public-section-title fb-public-section-title-spaced">
            <I18nText id="home.workspaceTitle" />
          </h2>
        </div>
        <div className="fb-public-feature-grid">
          <Feature
            icon={Newspaper}
            title={<I18nText id="home.featureReadingTitle" />}
            copy={<I18nText id="home.featureReadingCopy" />}
          />
          <Feature
            icon={Radio}
            title={<I18nText id="home.featureFollowingTitle" />}
            copy={<I18nText id="home.featureFollowingCopy" />}
          />
          <Feature
            icon={Search}
            title={<I18nText id="common.search" />}
            copy={<I18nText id="home.featureSearchCopy" />}
          />
        </div>
      </section>
      <footer className="fb-public-section">
        <div className="fb-public-nav-actions">
          <Link className="fb-login-nav-link" href="/privacy">
            <I18nText id="common.privacy" />
          </Link>
          <Link className="fb-login-nav-link" href="/terms">
            <I18nText id="common.terms" />
          </Link>
        </div>
      </footer>
      </main>
    </>
  );
}

function Feature({
  icon: Icon,
  title,
  copy,
}: {
  icon: typeof Newspaper;
  title: ReactNode;
  copy: ReactNode;
}) {
  return (
    <article className="fb-signal">
      <Icon className="fb-public-feature-icon" aria-hidden="true" />
      <div>
        <h3 className="fb-public-card-title">{title}</h3>
        <p className="fb-public-card-copy is-compact">{copy}</p>
      </div>
    </article>
  );
}
