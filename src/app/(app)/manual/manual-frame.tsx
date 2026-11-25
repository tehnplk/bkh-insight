"use client";

import { useEffect, useRef } from "react";

// คู่มือเป็นไฟล์ static ใน public/manuals/ (origin เดียวกัน) จึงใส่ data-theme ของแอปให้เอกสารใน iframe ตามธีมที่เลือกได้
function syncTheme(frame: HTMLIFrameElement | null) {
  const doc = frame?.contentDocument;
  const theme = document.documentElement.dataset.theme;
  if (doc && theme) doc.documentElement.dataset.theme = theme;
}

export function ManualFrame({ src, title }: { src: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    syncTheme(ref.current);
    const mo = new MutationObserver(() => syncTheme(ref.current));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  return (
    <iframe
      ref={ref}
      src={src}
      title={title}
      onLoad={(e) => syncTheme(e.currentTarget)}
      className="min-h-0 w-full flex-1 rounded-lg border border-line bg-surface"
    />
  );
}
