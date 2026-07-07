import type { LegalBlock } from "@/lib/legal-pages";

type LegalPageMeta = {
  eyebrow: string;
  title: string;
  updatedLabel: string;
  contactLabel: string;
  navLabel: string;
};

type LegalPageProps = {
  blocks: LegalBlock[];
  contactEmail: string;
  intro: string;
  meta: LegalPageMeta;
  updatedDate: string;
};

export function LegalPage({ blocks, contactEmail, intro, meta, updatedDate }: LegalPageProps) {
  return (
    <main className="fb-landing-grid min-h-screen">
      <section className="legal-page-shell">
        <div className="fb-public-section legal-page-frame">
          <div className="legal-hero">
            <span className="fb-section-label">{meta.eyebrow}</span>
            <h1 className="fb-public-title">{meta.title}</h1>
            <p className="fb-public-copy legal-intro">{intro}</p>
            <dl className="legal-meta-list">
              <div>
                <dt>{meta.updatedLabel}</dt>
                <dd>{updatedDate}</dd>
              </div>
              <div>
                <dt>{meta.contactLabel}</dt>
                <dd>
                  <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
                </dd>
              </div>
            </dl>
          </div>

          <div className="legal-content-layout">
            <nav className="legal-toc" aria-label={meta.navLabel}>
              <p className="legal-toc-title">{meta.navLabel}</p>
              <ol>
                {blocks.map((block, index) => (
                  <li key={block.id}>
                    <a className="legal-toc-link" href={`#${block.id}`}>
                      <span>{formatSectionNumber(index)}</span>
                      <span>{block.title}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>

            <div className="legal-document">
              {blocks.map((block, index) => (
                <section className="legal-section" id={block.id} key={block.id}>
                  <span className="legal-section-index">{formatSectionNumber(index)}</span>
                  <div className="legal-section-body">
                    <h2>{block.title}</h2>
                    <p>{block.copy}</p>
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function formatSectionNumber(index: number) {
  return String(index + 1).padStart(2, "0");
}
