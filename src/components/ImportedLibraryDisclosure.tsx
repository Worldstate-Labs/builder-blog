"use client";

import { useId, useState, type ReactNode } from "react";
import { SourceLibraryItemsArea } from "@/components/SourceLibraryItemsArea";

export function ImportedLibraryDisclosure({
  action,
  children,
  defaultOpen = false,
  indented = false,
  metadata,
  title,
  toggle,
}: {
  action?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  indented?: boolean;
  metadata?: ReactNode;
  title: ReactNode;
  toggle: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentId = useId();
  const panelClassName = `library-section-panel library-section-panel-imported${indented ? " library-section-panel-indented" : ""}`;

  return (
    <article className={panelClassName}>
      <div className="library-section-summary library-section-summary--static library-section-summary--imported-header">
        <div className="library-section-summary-copy">
          <h3 className="fb-section-heading">{title}</h3>
          <div className="library-section-meta library-section-meta--imported">
            <div className="library-section-imported-metadata">{metadata}</div>
            {action}
          </div>
        </div>
      </div>
      <button
        aria-controls={contentId}
        aria-expanded={isOpen}
        className="library-section-imported-toggle"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <div className="library-section-copy">{toggle}</div>
      </button>
      <div className="library-section-body" hidden={!isOpen} id={contentId}>
        <SourceLibraryItemsArea>{children}</SourceLibraryItemsArea>
      </div>
    </article>
  );
}
