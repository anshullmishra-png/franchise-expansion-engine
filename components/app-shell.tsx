"use client";

import { MapPinned } from "lucide-react";
import { AssumptionsDrawer } from "@/components/assumptions-drawer";
import { DrawerRoot } from "@/components/applicant-drawer";
import { Banners } from "@/components/banners";
import { ChatPanel } from "@/components/chat-panel";
import { CursorEffects } from "@/components/cursor-effects";
import { Home } from "@/components/home";
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
      <nav className="sticky top-0 z-20 -mx-4 overflow-x-auto border-b border-ink-200/80 bg-paper/95 px-4 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8" aria-label="Sections">
        <div className="flex gap-1" role="tablist">
          {tabs.map(([k, label, n]) => {
            const on = s.tab === k;
            return (
              <button
                key={k}
                role="tab"
                aria-selected={on}
                onClick={() => s.setTab(k)}
                className={`group relative flex items-center gap-2 px-4 py-3.5 text-[15px] font-medium whitespace-nowrap outline-none transition-colors ${on ? "text-ink-900" : "text-ink-500 hover:text-ink-900"}`}
              >
                {label}
                {n !== null ? (
                  <span className={`rounded-full px-2 py-0.5 text-xs tabular-nums transition-colors ${on ? "bg-teal-100 text-teal-800" : "bg-ink-100 text-ink-600 group-hover:bg-teal-50 group-hover:text-teal-800"}`}>{n}</span>
                ) : null}
                <span
                  className={`absolute inset-x-3 bottom-0 h-0.5 origin-left rounded-full bg-teal-700 transition-transform duration-200 ${on ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100 group-hover:bg-teal-700/40"}`}
                  aria-hidden
                />
              </button>
            );
          })}
        </div>
      </nav>
      <div key={s.tab} className="rise-in pt-8 pb-6" role="tabpanel">
        {s.tab === "overview" ? <OverviewTab /> : null}
        {s.tab === "applications" ? <ApplicationsTab /> : null}
        {s.tab === "territories" ? <TerritoriesTab /> : null}
        {s.tab === "map" ? <MapTab /> : null}
        {s.tab === "changes" ? <ChangeLogTab /> : null}
      </div>
    </>
  );
}

function Workspace() {
  const s = useStore();
  return (
    <div className="flex h-dvh flex-col">
      <TopBar />
      {/* On wide screens the page makes room for the chat when it is open, so nothing is hidden behind it. */}
      <main className={`min-w-0 flex-1 overflow-y-auto transition-[padding] duration-300 ${s.chatOpen ? "xl:pr-[26rem]" : ""}`}>
        <Banners />
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <Tabs />
        </div>
        <footer className="mt-12 border-t border-ink-200 bg-white">
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-3 px-4 py-6 text-[13px] text-ink-500 sm:flex-row sm:items-center sm:px-6 lg:px-8">
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
      <DrawerRoot />
      <AssumptionsDrawer />
    </div>
  );
}

function Shell() {
  const s = useStore();
  return (
    <>
      <CursorEffects />
      {s.input ? <Workspace /> : <Home />}
    </>
  );
}

export function AppShell() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
