"use client";

import { useState, type ReactNode } from "react";

type Tab = "private" | "imported";

export function MobileSourcesSwitcher({
  privateLabel,
  importedLabel,
  privateSection,
  importedSection,
}: {
  privateLabel: string;
  importedLabel: string;
  privateSection: ReactNode;
  importedSection: ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<Tab>("private");

  return (
    <>
      <div
        className="fb-segmented-tabs mobile-filter-tabs at-mobile"
        role="tablist"
        aria-label="Sources view"
      >
        <button
          aria-selected={activeTab === "private"}
          className="fb-btn compact"
          data-active={activeTab === "private" ? "true" : undefined}
          onClick={() => setActiveTab("private")}
          role="tab"
          type="button"
        >
          {privateLabel}
        </button>
        <button
          aria-selected={activeTab === "imported"}
          className="fb-btn compact"
          data-active={activeTab === "imported" ? "true" : undefined}
          onClick={() => setActiveTab("imported")}
          role="tab"
          type="button"
        >
          {importedLabel}
        </button>
      </div>
      <div className="mobile-sources-stack" data-active-tab={activeTab}>
        <div data-tab="private">{privateSection}</div>
        <div data-tab="imported">{importedSection}</div>
      </div>
    </>
  );
}
