"use client";

import { createContext, useContext, useState, useTransition } from "react";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import { formatCount } from "@/lib/number-format";
import type { AdminUser, Organization } from "@/app/api/admin/users/route";

const col = gridColumnHelper<AdminUser>();
// Column header filters from /api/admin/users?facet=<id> (not organizations: a JSON array).
const filter = { filter: true } as const;
const columns = col.columns([
  // Running number across pages: DataGrid feeds pageIndex/pageSize (from the URL) into the table state.
  col.display({
    id: "no",
    header: "ลำดับ",
    cell: (info) => {
      const p = info.table.options.state?.pagination;
      return (p ? p.pageIndex * p.pageSize : 0) + info.row.index + 1;
    },
    meta: { className: "text-right" },
  }),
  col.accessor("provider_id", {
    header: "Provider ID",
    cell: (info) => (
      <span title={info.getValue()} className="block max-w-32 truncate text-xs text-muted">
        {info.getValue()}
      </span>
    ),
    meta: filter,
  }),
  col.accessor("pname", { header: "คำนำหน้า", enableSorting: false, meta: filter }),
  col.accessor("fname", { header: "ชื่อ", meta: filter }),
  col.accessor("lname", { header: "นามสกุล", meta: filter }),
  col.accessor("job_position", { header: "ตำแหน่ง", cell: (info) => info.getValue() ?? "–", meta: filter }),
  col.accessor("organizations", {
    header: "หน่วยบริการ",
    enableSorting: false,
    cell: (info) => <OrgCell orgs={info.getValue()} />,
  }),
  col.accessor("role", {
    header: "role",
    cell: (info) => <RoleCell user={info.row.original} reload={() => info.table.options.meta?.reload()} />,
    meta: filter,
  }),
  col.accessor("is_approve", {
    header: "สถานะ",
    cell: (info) =>
      info.getValue() ? (
        <span className="rounded border border-success-line bg-success-soft px-1.5 py-0.5 whitespace-nowrap text-success">อนุมัติแล้ว</span>
      ) : (
        <span className="rounded border border-warning-line bg-warning-soft px-1.5 py-0.5 whitespace-nowrap text-warning">รออนุมัติ</span>
      ),
    meta: filter,
  }),
  col.accessor("login_count", {
    header: "จำนวนครั้งที่เข้าใช้งาน",
    cell: (info) => formatCount(info.getValue()),
    meta: { className: "text-right tabular-nums", filter: true },
  }),
  col.accessor("his_doctor_code", {
    header: "รหัสแพทย์ HOSxP",
    enableSorting: false,
    cell: (info) => <DoctorCodeCell user={info.row.original} reload={() => info.table.options.meta?.reload()} />,
  }),
  col.display({
    id: "action",
    header: () => <span className="sr-only">การอนุมัติ</span>,
    cell: (info) => {
      const user = info.row.original;
      const approve = !user.is_approve;
      return (
        <RowAction
          body={{ id: user.id, approve }}
          label={approve ? "อนุมัติ" : "ยกเลิกอนุมัติ"}
          name={`${user.fname} ${user.lname}`}
          primary={approve}
          reload={() => info.table.options.meta?.reload()}
        />
      );
    },
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

// The signed-in admin's users.id (undefined for the super user), so their own row gets no role control.
const SelfId = createContext<string | undefined>(undefined);

function RoleCell({ user, reload }: { user: AdminUser; reload: () => void }) {
  const self = useContext(SelfId) === user.id;
  const toAdmin = user.role !== "admin";
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      {user.role}
      {!self && (
        <RowAction
          body={{ id: user.id, role: toAdmin ? "admin" : "user" }}
          label={toAdmin ? "ตั้งเป็น admin" : "ยกเลิก admin"}
          name={`${user.fname} ${user.lname}`}
          primary={false}
          reload={reload}
        />
      )}
    </span>
  );
}

// รหัสแพทย์ใน HOSxP (doctor.code) ใช้เป็นผู้บันทึกตอนปิดสิทธิ (/fund/close-privilege) ว่าง = ล้าง ; API ตรวจว่ามีในระบบและมีเลขบัตร
function DoctorCodeCell({ user, reload }: { user: AdminUser; reload: () => void }) {
  const [draft, setDraft] = useState(user.his_doctor_code ?? "");
  const code = draft.trim();
  const name = `${user.fname} ${user.lname}`;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={10}
        aria-label={`รหัสแพทย์ HOSxP ของ ${name}`}
        className="h-7 w-20 rounded-md border border-line bg-surface px-2 tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {code !== (user.his_doctor_code ?? "") && (
        <RowAction body={{ id: user.id, his_doctor_code: code || null }} label={code ? "บันทึก" : "ล้าง"} name={`รหัสแพทย์ ${name}`} primary={false} reload={reload} />
      )}
    </span>
  );
}

// One POST to /api/admin/users per click (approve or role), then reload the grid. Disabled while pending,
// the error shows in the row.
function RowAction({
  body,
  label,
  name,
  primary,
  reload,
}: {
  body: { id: string; approve: boolean } | { id: string; role: string } | { id: string; his_doctor_code: string | null };
  label: string;
  name: string;
  primary: boolean;
  reload: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function send() {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? `บันทึกไม่สำเร็จ (HTTP ${res.status})`);
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
        onClick={send}
        disabled={pending}
        aria-label={`${label} ${name}`}
        className={`inline-flex h-7 items-center rounded-md border px-2.5 font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50 ${
          primary ? "border-transparent bg-accent text-accent-fg hover:bg-accent/90" : "border-line bg-surface text-foreground hover:bg-hover"
        }`}
      >
        {label}
      </button>
    </span>
  );
}

export function UsersGrid({ selfId }: { selfId?: string }) {
  return (
    <SelfId value={selfId}>
      <DataGrid<AdminUser> endpoint="/api/admin/users" columns={columns} getRowId={(r) => r.id} />
    </SelfId>
  );
}
