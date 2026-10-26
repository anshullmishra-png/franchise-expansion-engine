"use client";

import { Menu } from "@base-ui/react/menu";
import { FileDown, FlaskConical, MoreHorizontal, RotateCcw, SlidersHorizontal } from "lucide-react";

const item =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] font-medium text-ink-700 outline-none transition-colors data-[highlighted]:bg-teal-50 data-[highlighted]:text-ink-900 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50";

/** The less-used actions, tucked into one menu so the top bar stays calm. */
export function MoreMenu({
  busy,
  canReset,
  onLoadSample,
  onAssumptions,
  onStartOver,
}: {
  busy: boolean;
  canReset: boolean;
  onLoadSample: () => void;
  onAssumptions: () => void;
  onStartOver: () => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="More actions"
        title="More actions"
        className="press inline-flex size-9 items-center justify-center rounded-lg border border-ink-200 bg-white text-ink-600 shadow-card outline-none hover:bg-teal-50 hover:text-ink-900 data-[popup-open]:bg-teal-50 data-[popup-open]:text-ink-900"
      >
        <MoreHorizontal className="size-[18px]" aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={8} align="end" className="z-50">
          <Menu.Popup className="w-64 origin-(--transform-origin) rounded-xl border border-ink-200 bg-white p-1.5 shadow-pop transition-[opacity,transform] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
            <Menu.Item className={item} disabled={busy} onClick={onLoadSample}>
              <FlaskConical className="size-4 text-teal-700" aria-hidden /> Load sample data
            </Menu.Item>
            <Menu.LinkItem className={item} href="/Case1_Franchise_Test_Data_Format.xlsx" download>
              <FileDown className="size-4 text-teal-700" aria-hidden /> Download template
            </Menu.LinkItem>
            <Menu.Item className={item} onClick={onAssumptions}>
              <SlidersHorizontal className="size-4 text-teal-700" aria-hidden /> Assumptions
            </Menu.Item>
            <div className="my-1 h-px bg-ink-100" role="separator" />
            <Menu.Item className={`${item} data-[highlighted]:!bg-rejected-soft data-[highlighted]:!text-rejected-ink`} disabled={!canReset} onClick={onStartOver}>
              <RotateCcw className="size-4" aria-hidden /> Start over
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
