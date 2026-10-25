"use client";

import { Component, type ReactNode } from "react";

/** If the map ever fails (blocked scripts, a tile library error), show a calm message instead of a blank page. */
export class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean; attempt: number }> {
  state = { failed: false, attempt: 0 };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="grid h-full place-items-center bg-white p-6 text-center text-sm text-ink-600" role="alert">
          <div>
            <p className="font-semibold text-ink-900">The map couldn&apos;t load.</p>
            <p className="mt-1">Everything else still works. Each applicant&apos;s drawer lists the nearby stores and distances.</p>
            <button
              type="button"
              onClick={() => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }))}
              className="mt-3 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-800 shadow-card hover:bg-teal-50"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return <div key={this.state.attempt} className="h-full w-full">{this.props.children}</div>;
  }
}
