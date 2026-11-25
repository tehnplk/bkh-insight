import { ExternalLink } from "lucide-react";
import { ManualFrame } from "../manual-frame";

const TITLE = "คู่มือลูกหนี้งานการเงิน";
const SRC = "/manuals/ar-finance/index.html";
export const metadata = { title: TITLE };

export default function Page() {
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-title text-balance">{TITLE}</h1>
        <a
          href={SRC}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-muted hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <ExternalLink className="size-3.5" aria-hidden />
          เปิดในแท็บใหม่
        </a>
      </div>
      <ManualFrame src={SRC} title={TITLE} />
    </div>
  );
}
