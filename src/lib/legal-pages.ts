export type LegalBlock = {
  id: string;
  title: string;
  copy: string;
};

export const legalUpdatedDate = "July 7, 2026";
export const legalContactEmail = "legal@worldstatelabs.com";

export const privacyPageMeta = {
  eyebrow: "Privacy",
  title: "FollowBrief Privacy Policy",
  updatedLabel: "Updated",
  contactLabel: "Contact",
  navLabel: "Policy sections",
} as const;

export const privacyIntro =
  `Last updated: ${legalUpdatedDate}. This policy explains what FollowBrief collects, why it is used, how Hub sharing works, and how you can access, export, correct, or delete account data. Contact: ${legalContactEmail}.`;

export const privacyBlocks: LegalBlock[] = [
  {
    id: "data-we-collect",
    title: "Data we collect",
    copy: "Account and identity data includes your OAuth profile, email, name, image, sessions, and sign-in provider records. Content and source data includes sources, subscriptions, feed items, read history, favorites, AI Digest issues, digest runs, recommendations, Hub imports, Hub shares, source submissions, summary language, and editable prompt/settings records. Usage, device, and diagnostic data includes Local Agent activity, cron status, fetch logs, cloud fetch queue and run records, access keys, token use, IP address, User-Agent, hostname, platform, runtime, error details, token and cost summaries, and timestamps needed to operate the app and protect your account.",
  },
  {
    id: "how-we-use-it",
    title: "How we use it",
    copy: "FollowBrief uses this data to authenticate you, fetch source updates, build cited AI Digest issues, keep search and recommendations useful, sync cloud source libraries, show account activity in Settings, secure sessions, prevent abuse, debug failures, honor account export and account deletion requests, and maintain operational records. Where laws require a legal basis, we rely on contract performance, legitimate interests in operating and securing the service, consent where requested, and legal compliance.",
  },
  {
    id: "ai-automation-source-content",
    title: "AI, automation, and source content",
    copy: "Source content may be summarized by AI services, local models, or user-configured agent runtimes. AI summaries and recommendations are assistive; they are not used to make legal, financial, employment, housing, credit, health, or insurance decisions about you. Your Local Agent may temporarily process crawled source content on your machine to generate summaries. FollowBrief stores durable raw content only when the source type policy allows it; higher-risk sources may retain only summaries, short excerpts, structured facts, source links, and processing provenance.",
  },
  {
    id: "service-providers",
    title: "Service providers",
    copy: "FollowBrief connects with third-party sources and APIs such as Google, GitHub, Apple, X, YouTube, Product Hunt, RSS feeds, websites, and OpenAI-style model providers when you choose those workflows. We also use OAuth providers and hosting, database, security, observability, AI, crawler, and agent runtime providers to operate the product. These providers process data only as needed for the service, security, support, or your selected integrations.",
  },
  {
    id: "cookies-security",
    title: "Cookies and security",
    copy: "We use session cookies and authentication cookies to keep you signed in, complete OAuth flows, and protect accounts. FollowBrief does not currently use advertising cookies in the app. Access keys are for Local Agent and cloud workflows; secret token material is not included in account export, and token use records may keep last-used IP address, User-Agent, hostname, platform, and user labels so you can recognize activity.",
  },
  {
    id: "hub-sharing",
    title: "Hub sharing",
    copy: "When you share source libraries or AI Digest collections to Hub, other users can see shared source names, source links, collection titles, headline metadata, descriptions, counts, owner display labels, imports, views, and public Hub activity. Private account data, access keys, OAuth tokens, raw crawled content, full transcripts, raw API objects, and private settings are not published to Hub.",
  },
  {
    id: "selling-advertising",
    title: "Selling and advertising",
    copy: "We do not sell personal information and do not share personal information for cross-context behavioral advertising. If FollowBrief later adds advertising, marketing analytics, or a sale/share practice that changes this statement, this policy must be updated before that practice starts.",
  },
  {
    id: "retention",
    title: "Retention",
    copy: "We retain account data while your account is active and keep operational logs only as long as needed for security, diagnostics, abuse prevention, and service reliability. Account deletion removes your user record and account-scoped records, including sessions, access keys, source library records, AI Digest records, preferences, reads, favorites, imports, and Hub sharing records. Operational backups and security logs may persist until they expire under normal retention schedules.",
  },
  {
    id: "your-rights",
    title: "Your rights",
    copy: "You can access, export, correct, and delete your information in Settings. Depending on where you live, you may also have rights to object, restrict processing, request portability, withdraw consent, appeal a denied request, or lodge a complaint with a privacy authority. You can stop sharing any Hub item before deleting your account, and source owners can contact FollowBrief to request review or removal of source material.",
  },
  {
    id: "children-changes",
    title: "Children and changes",
    copy: "FollowBrief is not intended for children under 13, and we do not knowingly collect information from children under 13. We may update this policy as the product changes. Material privacy changes should be presented clearly and should not retroactively expand use of previously collected data without appropriate notice or consent.",
  },
];

export const termsPageMeta = {
  eyebrow: "Terms",
  title: "FollowBrief Terms of Service",
  updatedLabel: "Updated",
  contactLabel: "Contact",
  navLabel: "Terms sections",
} as const;

export const termsIntro =
  `Last updated: ${legalUpdatedDate}. These terms cover your use of FollowBrief, Local Agent access, Hub sharing, third-party sources, third-party APIs, and AI Digest output. Contact: ${legalContactEmail}.`;

export const termsBlocks: LegalBlock[] = [
  {
    id: "use-of-service",
    title: "Use of the service",
    copy: "FollowBrief helps you follow sources, fetch updates, summarize source material, build AI Digest issues, sync cloud source libraries, search your own workspace, and import shared Hub collections. You must be able to form a binding contract to use FollowBrief. You are responsible for the sources you add, the prompts/settings you configure, the agent runtimes you run, and the way you use generated output.",
  },
  {
    id: "accounts-access-keys",
    title: "Accounts and access keys",
    copy: "You are responsible for keeping your account, devices, Local Agent files, and access keys secure. Local Agent commands run on your machine or in runtimes you configure using access keys you create in Settings. Keep each access key private, revoke keys you no longer use, and do not share keys, OAuth tokens, private digests, private source libraries, or private account data with others.",
  },
  {
    id: "third-party-content-apis",
    title: "Third-party content and APIs",
    copy: "Sources and metadata may come from third-party sources and third-party APIs including GitHub, Google, Apple, X, YouTube, Product Hunt, RSS feeds, websites, crawler tools, and model providers. Their platform terms continue to apply to the content, accounts, and API access you connect. FollowBrief does not give you rights to third-party content beyond the rights you already have.",
  },
  {
    id: "source-rights-retention",
    title: "Source rights and retention",
    copy: "Do not add private, paywalled, access-controlled, or platform-prohibited sources unless you have the right to fetch and summarize them. Do not use FollowBrief to scrape private areas, bypass paywalls, violate robots or rate limits, evade access controls, collect secrets, or infringe copyright, privacy, publicity, or contract rights. Local Agent may temporarily process raw source content, but durable raw retention depends on the source type; Hub sharing must not publish raw crawled content, full transcripts, raw API objects, or full third-party works. Source owners can contact FollowBrief to request review or removal of source material.",
  },
  {
    id: "ai-digest-output",
    title: "AI Digest output",
    copy: "AI Digest output is generated from source material and may be incomplete, stale, biased, or wrong. No professional advice is provided. Do not rely on FollowBrief as legal, medical, financial, security, tax, employment, housing, credit, health, insurance, or other professional advice. Check original sources before acting on important information.",
  },
  {
    id: "hub-sharing",
    title: "Hub sharing",
    copy: "If you share a source library or AI Digest collection to Hub, you grant FollowBrief permission to display the shared title, description, source names, source links, headline metadata, owner display label, import counts, view counts, and public collection activity to other users until you remove it. You must not share anything you do not have permission to publish.",
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    copy: "Do not use FollowBrief to break the law, attack systems, distribute malware, spam, harass people, impersonate others, misrepresent generated content as verified fact, overload the service, probe undocumented APIs, or interfere with other users. Do not attempt to reverse engineer, bypass security, or extract another user's data.",
  },
  {
    id: "account-controls-termination",
    title: "Account controls and termination",
    copy: "You may export or delete your account data from Settings. Deleting your account removes active access to FollowBrief and may remove shared Hub entries tied to your account. We may suspend or terminate access if needed to protect the service, comply with law, prevent abuse, or address violations of these terms.",
  },
  {
    id: "disclaimers-liability",
    title: "Disclaimers and liability",
    copy: "FollowBrief is provided AS IS and AS AVAILABLE. We do not promise uninterrupted service, error-free output, complete source coverage, or that generated summaries will match every original source. Limitation of liability applies to the maximum extent allowed by law; FollowBrief will not be liable for indirect, incidental, special, consequential, exemplary, or lost-profit damages.",
  },
  {
    id: "changes-governing-law",
    title: "Changes and governing law",
    copy: "We may update these terms as the product changes. Material changes should be presented clearly before they apply. These terms are governed by the laws of California, without regard to conflict-of-law rules, except where local law gives you mandatory rights that cannot be waived.",
  },
];
