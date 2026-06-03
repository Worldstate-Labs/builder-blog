"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { AddBuilderForm } from "@/components/AddBuilderForm";
import { CountChip } from "@/components/Count";
import {
  builderLibraryBuilderAdded,
  type BuilderLibraryEventItem,
} from "@/lib/builder-library-events";

type SourceOption = {
  id: string;
  label: string;
};

export function PrivateLibraryPanel({
  title,
  count,
  sourceOptions,
  visibilityToggle,
  children,
}: {
  title: string;
  count: number;
  sourceOptions: SourceOption[];
  visibilityToggle?: ReactNode;
  children: ReactNode;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);

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

  function toggleAdd(event: React.MouseEvent<HTMLButtonElement>) {
    // Prevent the surrounding <details> from toggling when the user clicks
    // the in-summary Add source button.
    event.preventDefault();
    event.stopPropagation();
    setAddOpen((open) => !open);
  }

  return (
    <details ref={detailsRef} className="library-section-panel" open>
      <summary className="library-section-summary">
        <div>
          <h2 className="fb-section-heading">{title}</h2>
        </div>
        <div className="library-section-meta">
          <CountChip label={count === 1 ? "source" : "sources"} value={count} />
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
      </summary>
      <div className="library-section-body">
        {addOpen ? (
          <div className="add-source-panel fb-panel">
            <AddBuilderForm sourceOptions={sourceOptions} />
          </div>
        ) : null}
        {children}
      </div>
    </details>
  );
}
