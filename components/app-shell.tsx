"use client";

import { MapPinned } from "lucide-react";
import { AssumptionsDrawer } from "@/components/assumptions-drawer";
import { DrawerRoot } from "@/components/applicant-drawer";
import { Banners } from "@/components/banners";
import { ChatPanel } from "@/components/chat-panel";
import { EmptyState } from "@/components/empty-state";
import { TopBar } from "@/components/top-bar";
import { ApplicationsTab } from "@/components/tabs/applications";
import { ChangeLogTab } from "@/components/tabs/change-log";
import { MapTab } from "@/components/tabs/map-tab";
import { OverviewTab } from "@/components/tabs/overview";
import { TerritoriesTab } from "@/components/tabs/territories";
import { StoreProvider, useStore, type TabKey } from "@/lib/state/store";

function Tabs() {
  const s = useStore();
  const tabs: [TabKey, string, number | null][] = [
    ["overview", "Overview", null],
    ["applications", "Applications", s.result?.decisions.length ?? null],
    ["territories", "Territories", s.result?.territories.length ?? null],
    ["map", "Map", null],
    ["changes", "Change log", s.log.length || null],
  ];
  return (
    <>
      <nav className="sticky top-0 z-20 -mx-4 overflow-x-auto border-b bg-background/95 px-4 backdrop-blur" aria-label="Sections">
        <div className="flex gap-1" role="tablist">
          {tabs.map(([k, label, n]) => (
            <button
              key={k}
              role="tab"
              aria-selected={s.tab === k}
              onClick={() => s.setTab(k)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap ${s.tab === k ? "border-brand text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {label}
              {n !== null ? <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">{n}</span> : null}
            </button>
          ))}
        </div>
      </nav>
      <div className="pt-4" role="tabpanel">
        {s.tab === "overview" ? <OverviewTab /> : null}
        {s.tab === "applications" ? <ApplicationsTab /> : null}
        {s.tab === "territories" ? <TerritoriesTab /> : null}
        {s.tab === "map" ? <MapTab /> : null}
        {s.tab === "changes" ? <ChangeLogTab /> : null}
      </div>
    </>
  );
}

function Shell() {
  const s = useStore();

  return (
    <div className="flex h-dvh flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto pb-20 lg:pb-6">
          <Banners />
          {s.input ? (
            <div className="px-4">
              <Tabs />
            </div>
          ) : (
            <EmptyState />
          )}
          <footer className="mt-10 border-t border-ink-200 bg-white">
            <div className="flex flex-col items-start justify-between gap-3 px-4 py-6 text-[13px] text-ink-500 sm:flex-row sm:items-center lg:px-6">
              <div className="flex items-center gap-2">
                <span className="grid size-6 place-items-center rounded-md bg-teal-700 text-white" aria-hidden>
                  <MapPinned className="size-3.5" />
                </span>
                <span className="font-semibold text-ink-700">Franchise Expansion Engine</span>
                <span className="text-ink-300">·</span>
                <span>Rules decide, AI explains</span>
              </div>
              <p>Coordinates are pin-code centres, so distances are estimates. Your data stays in this browser.</p>
            </div>
          </footer>
        </main>
        <ChatPanel />
      </div>
      <DrawerRoot />
      <AssumptionsDrawer />
    </div>
  );
}

export function AppShell() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
