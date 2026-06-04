"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { AddBuilderForm } from "@/components/AddBuilderForm";
import { CountMeta } from "@/components/Count";
import {
  builderLibraryBuilderAdded,
  type BuilderLibraryEventItem,
} from "@/lib/builder-library-events";

type SourceOption = {
  id: string;
  label: string;
};

export function PrivateLibraryPanel({
  beforeBody,
  className,
  headingId,
  title,
  count,
  sourceOptions,
  visibilityToggle,
  children,
}: {
  beforeBody?: ReactNode;
  className?: string;
  headingId?: string;
  title: string;
  count: number;
  sourceOptions: SourceOption[];
  visibilityToggle?: ReactNode;
  children: ReactNode;
}) {
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    function onBuilderAdded(event: Event) {
      // Keep the panel open when the add returned a soft warning —
      // unmounting AddBuilderForm would also discard the warm banner
      // before the user ever sees it. The user closes manually.
      const detail = (event as CustomEvent<BuilderLibraryEventItem>).detail;
      if (detail?.addWarning) return;
      setAddOpen(false);
    }
    window.addEventListener(builderLibraryBuilderAdded, onBuilderAdded);
    return () =>
      window.removeEventListener(builderLibraryBuilderAdded, onBuilderAdded);
  }, []);

  function toggleAdd() {
    setAddOpen((open) => !open);
  }

  return (
    <section
      aria-labelledby={headingId}
      className={className ?? "library-section-panel"}
    >
      <div className="library-section-summary library-section-summary--static">
        <div>
          <h2 id={headingId} className="fb-section-heading">
            {title}
          </h2>
        </div>
        <div className="library-section-meta">
          <CountMeta label={count === 1 ? "source" : "sources"} value={count} />
          {visibilityToggle}
          <button
            aria-expanded={addOpen}
            aria-label={addOpen ? "Close add source" : "Add source"}
            className="fb-btn dark compact"
            onClick={toggleAdd}
            type="button"
          >
            {addOpen ? <X aria-hidden="true" /> : <Plus aria-hidden="true" />}
            {addOpen ? "Close" : "Add source"}
          </button>
        </div>
      </div>
      <div className="library-section-body">
        {beforeBody}
        {addOpen ? (
          <div className="add-source-panel fb-panel">
            <AddBuilderForm sourceOptions={sourceOptions} />
          </div>
        ) : null}
        {children}
      </div>
    </section>
  );
}
