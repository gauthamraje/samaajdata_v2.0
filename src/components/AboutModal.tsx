"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export function AboutModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>("button, a")?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-console-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-sky-100 bg-white shadow-xl"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-sky-100 bg-white px-4 py-3">
          <h2 id="about-console-title" className="text-sm font-semibold text-slate-900">
            About this console
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-sky-50 hover:text-slate-800"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 px-4 py-4 text-sm text-slate-600">
          <p>
            <a
              href="https://samaajdata.org"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-sky-700 hover:underline"
            >
              Samaaj Data
            </a>{" "}
            is a collective for civic intelligence — data, governance context, and citizen action. This{" "}
            <strong className="font-medium text-slate-800">Ward Intelligence Console</strong> is a pilot tool:
            explore the map, compare areas, and read curated signals — not a government system.
          </p>
          <div className="rounded-xl border border-sky-100 bg-sky-50/80 px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">Trust &amp; verification</p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-600">
              <li>
                <strong className="font-medium text-slate-700">Solutions</strong> show a verification level (community,
                knowledge base, or official-style when you add it in data). Always check the source link when
                provided.
              </li>
              <li>
                <strong className="font-medium text-slate-700">Commitments</strong> are &quot;promise lite&quot; cards
                backed by editable JSON — replace sample text with real sources before wider use.
              </li>
              <li>
                <strong className="font-medium text-slate-700">Ward contacts</strong> come from{" "}
                <code className="rounded bg-white px-1 text-[11px]">ward_contacts.json</code> — verify phones and URLs
                locally.
              </li>
            </ul>
          </div>
          <p className="text-xs text-slate-500">
            We take <strong className="font-medium text-slate-700">design inspiration</strong> from how civic ecosystems
            combine resident voice, verifiable signals, and collaborative networks — without endorsing or linking to
            specific external products here.
          </p>
        </div>
      </div>
    </div>
  );
}
