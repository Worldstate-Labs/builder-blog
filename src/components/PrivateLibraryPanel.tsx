"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { AddBuilderForm } from "@/components/AddBuilderForm";
import { SourceLibraryItemsArea } from "@/components/SourceLibraryItemsArea";
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
  hideHeader = false,
  title,
  sourceOptions,
  visibilityToggle,
  children,
}: {
  beforeBody?: ReactNode;
  className?: string;
  headingId?: string;
  hideHeader?: boolean;
  title: string;
  sourceOptions: SourceOption[];
  visibilityToggle?: ReactNode;
  children: ReactNode;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const addPanelId = useId();

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
      aria-labelledby={!hideHeader ? headingId : undefined}
      className={className ?? "library-section-panel"}
    >
      {!hideHeader ? (
        <div className="library-section-summary library-section-summary--static">
          <div>
            <h2 id={headingId} className="fb-section-heading">
              {title}
            </h2>
          </div>
          {visibilityToggle ? (
            <div className="library-section-meta">
              {visibilityToggle}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="library-section-body">
        {beforeBody}
        <SourceLibraryItemsArea
          controls={
            <button
              aria-controls={addPanelId}
              aria-expanded={addOpen}
              aria-label={addOpen ? "Close add source form" : "Add source"}
              className="library-add-source-toggle"
              onClick={toggleAdd}
              type="button"
            >
              {addOpen ? <X aria-hidden="true" /> : <Plus aria-hidden="true" />}
              <span>{addOpen ? "Close add source form" : "Add source"}</span>
            </button>
          }
          addPanel={
            addOpen ? (
              <div className="add-source-panel fb-panel" id={addPanelId}>
                <AddBuilderForm sourceOptions={sourceOptions} />
              </div>
            ) : null
          }
        >
          {children}
        </SourceLibraryItemsArea>
      </div>
    </section>
  );
}
