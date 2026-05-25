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
      <div className="at-mobile fb-m-segctl" role="tablist" aria-label="Sources view">
        <button
          aria-selected={activeTab === "private"}
          className={`fb-m-seg${activeTab === "private" ? " active" : ""}`}
          onClick={() => setActiveTab("private")}
          role="tab"
          type="button"
        >
          {privateLabel}
        </button>
        <button
          aria-selected={activeTab === "imported"}
          className={`fb-m-seg${activeTab === "imported" ? " active" : ""}`}
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
