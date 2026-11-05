"use client";

type Option<T extends string> = { readonly value: T; readonly label: string };

/** ปุ่มเลือกหนึ่งค่าแบบแบ่งช่อง (role=group + aria-pressed) ความสูงเท่า ThaiDateStepper/MultiSelect */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex h-9 items-center gap-0.5 rounded-md border border-line bg-surface px-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => !on && onChange(o.value)}
            className={`h-8 rounded-md px-2.5 whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              on ? "bg-accent-soft font-medium text-accent-text" : "text-muted hover:bg-hover hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
