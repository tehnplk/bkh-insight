"use client";

import { useState, useTransition } from "react";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import type { AdminUser, Organization } from "@/app/api/admin/users/route";

const col = gridColumnHelper<AdminUser>();
const columns = col.columns([
  col.accessor("pname", { header: "คำนำหน้า", enableSorting: false }),
  col.accessor("fname", { header: "ชื่อ" }),
  col.accessor("lname", { header: "นามสกุล" }),
  col.accessor("job_position", { header: "ตำแหน่ง", cell: (info) => info.getValue() ?? "–" }),
  col.accessor("organizations", {
    header: "หน่วยบริการ",
    enableSorting: false,
    cell: (info) => <OrgCell orgs={info.getValue()} />,
  }),
  col.accessor("role", { header: "role" }),
  col.accessor("is_approve", {
    header: "สถานะ",
    cell: (info) =>
      info.getValue() ? (
        <span className="rounded border border-success-line bg-success-soft px-1.5 py-0.5 whitespace-nowrap text-success">อนุมัติแล้ว</span>
      ) : (
        <span className="rounded border border-warning-line bg-warning-soft px-1.5 py-0.5 whitespace-nowrap text-warning">รออนุมัติ</span>
      ),
  }),
  col.display({
    id: "action",
    header: () => <span className="sr-only">การอนุมัติ</span>,
    cell: (info) => <ApproveButton user={info.row.original} reload={() => info.table.options.meta?.reload()} />,
    meta: { className: "text-right" },
  }),
]);

const orgName = (o: Organization) => o.org_name ?? o.org_code ?? "–";

// First organization; any others fold out under a native <details> (keyboard and screen reader support built in).
function OrgCell({ orgs }: { orgs: Organization[] }) {
  const [first, ...rest] = orgs;
  if (!first) return "–";
  if (!rest.length) return orgName(first);
  return (
    <details className="group">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {orgName(first)}
        <span aria-hidden="true" className="rounded border border-accent-line bg-accent-soft px-1 text-accent-text">
          +{rest.length}
        </span>
        <span className="sr-only">และอีก {rest.length} แห่ง</span>
        <svg viewBox="0 0 20 20" aria-hidden="true" className="size-3.5 text-muted transition-transform group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 5l5 5-5 5" />
        </svg>
      </summary>
      <ul className="mt-1 space-y-0.5 text-muted">
        {rest.map((o, i) => (
          <li key={i}>{orgName(o)}</li>
        ))}
      </ul>
    </details>
  );
}

function ApproveButton({ user, reload }: { user: AdminUser; reload: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const approve = !user.is_approve;

  function toggle() {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id, approve }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? `บันทึกไม่สำเร็จ (HTTP ${res.status})`);
        return;
      }
      reload();
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && (
        <span role="alert" className="text-danger">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-label={`${approve ? "อนุมัติ" : "ยกเลิกอนุมัติ"} ${user.fname} ${user.lname}`}
        className={`inline-flex h-7 items-center rounded-md border px-2.5 font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50 ${
          approve ? "border-transparent bg-accent text-accent-fg hover:bg-accent/90" : "border-line bg-surface text-foreground hover:bg-hover"
        }`}
      >
        {approve ? "อนุมัติ" : "ยกเลิกอนุมัติ"}
      </button>
    </span>
  );
}

export function UsersGrid() {
  return <DataGrid<AdminUser> endpoint="/api/admin/users" columns={columns} getRowId={(r) => r.id} />;
}
