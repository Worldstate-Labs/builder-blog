import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { PublicHeader } from "@/components/PublicHeader";
import { getCurrentSession } from "@/lib/auth";
import {
  legalContactEmail,
  legalUpdatedDate,
  termsBlocks,
  termsIntro,
  termsPageMeta,
} from "@/lib/legal-pages";

export const metadata: Metadata = {
  title: "Terms",
  alternates: { canonical: "/terms" },
};

export default async function TermsPage() {
  const session = await getCurrentSession();

  return (
    <>
      <PublicHeader current="terms" session={session} />
      <LegalPage
        blocks={termsBlocks}
        contactEmail={legalContactEmail}
        intro={termsIntro}
        meta={termsPageMeta}
        updatedDate={legalUpdatedDate}
      />
    </>
  );
}
