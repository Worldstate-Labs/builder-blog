import { LegalPage } from "@/components/LegalPage";
import { PublicHeader } from "@/components/PublicHeader";
import { getCurrentSession } from "@/lib/auth";
import {
  legalContactEmail,
  legalUpdatedDate,
  privacyBlocks,
  privacyIntro,
  privacyPageMeta,
} from "@/lib/legal-pages";

export default async function PrivacyPage() {
  const session = await getCurrentSession();

  return (
    <>
      <PublicHeader current="privacy" session={session} />
      <LegalPage
        blocks={privacyBlocks}
        contactEmail={legalContactEmail}
        intro={privacyIntro}
        meta={privacyPageMeta}
        updatedDate={legalUpdatedDate}
      />
    </>
  );
}
