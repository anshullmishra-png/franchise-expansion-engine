"use client";

import { IdText } from "@/components/id-text";

/** The little bit of markdown the chat uses: **bold**, "- " bullets and line breaks. APP-/TER- IDs become links. */
export function RichText({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];

  const inline = (line: string) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i}><IdText text={part.slice(2, -2)} /></strong>
      ) : (
        <IdText key={i} text={part} />
      )
    );

  const flush = () => {
    if (!bullets.length) return;
    out.push(
      <ul key={`ul${out.length}`} className="my-1 list-disc space-y-0.5 pl-5">
        {bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}
      </ul>
    );
    bullets = [];
  };

  lines.forEach((line, i) => {
    if (/^\s*-\s+/.test(line)) {
      bullets.push(line.replace(/^\s*-\s+/, ""));
      return;
    }
    flush();
    if (line.trim() === "") return;
    out.push(<p key={`p${i}`} className="[&:not(:first-child)]:mt-1.5">{inline(line)}</p>);
  });
  flush();
  return <>{out}</>;
}
