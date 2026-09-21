// 共享展示小组件
import type { ReactNode } from "react";
import type {
  IdentifyStatus,
  LoanStatus,
  MigrationStatus,
  PressStatus,
} from "./model";

export function formatDate(ts: number | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const TONE: Record<string, string> = {
  green: "badge-green",
  teal: "badge-teal",
  amber: "badge-amber",
  gray: "badge-gray",
  red: "badge-red",
  blue: "badge-blue",
};

export function Badge({ tone = "gray", children }: { tone?: keyof typeof TONE; children: ReactNode }) {
  return <span className={`badge ${TONE[tone]}`}>{children}</span>;
}

export function pressTone(press: PressStatus): keyof typeof TONE {
  return press === "已压制" ? "green" : "amber";
}

export function identifyTone(identify: IdentifyStatus): keyof typeof TONE {
  if (identify === "已鉴定") return "green";
  if (identify === "存疑") return "amber";
  return "gray";
}

export function loanTone(loan: LoanStatus): keyof typeof TONE {
  return loan === "在馆" ? "teal" : "blue";
}

export function migrationTone(status: MigrationStatus): keyof typeof TONE {
  switch (status) {
    case "reserved":
      return "amber";
    case "migrated":
      return "green";
    case "returned":
      return "red";
    case "rejected":
      return "red";
    case "cancelled":
      return "gray";
  }
}

export const MIGRATION_LABEL: Record<MigrationStatus, string> = {
  reserved: "迁移中",
  migrated: "已迁移",
  rejected: "已拒绝",
  cancelled: "已取消",
  returned: "差异退回",
};

export const DISCREPANCY_LABEL = {
  "cabinet-mismatch": "柜位不符",
  "target-occupied": "目标已占用",
} as const;

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
