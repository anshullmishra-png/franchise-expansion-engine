"use client";

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
