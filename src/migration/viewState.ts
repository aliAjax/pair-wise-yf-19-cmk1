// 视图状态：队列筛选、选中标本、操作反馈与本地数据同步

import { useEffect, useMemo, useState } from "react";
import { HerbariumState, Specimen, loadState, saveState } from "./model";
import {
  IntakeDraft,
  RuleResult,
  applyMigration,
  cancelMigration,
  closeReview,
  intakeSpecimen,
  receiveMigration,
  setBorrowed,
  setIdentified,
} from "./rules";

export interface Notice {
  kind: "ok" | "err";
  text: string;
}

export const QUEUE_FILTERS = ["全部", "待入库", "已入库", "待鉴定", "迁移中"] as const;
export type QueueFilter = (typeof QUEUE_FILTERS)[number];

export function useMigrationView() {
  const [state, setState] = useState<HerbariumState>(loadState);
  const [filter, setFilter] = useState<QueueFilter>("全部");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  // 本地数据同步：任何状态变化都写回 localStorage，刷新保留
  useEffect(() => {
    saveState(state);
  }, [state]);

  const queue = useMemo(() => {
    switch (filter) {
      case "待入库":
        return state.specimens.filter((s) => s.status === "待入库");
      case "已入库":
        return state.specimens.filter((s) => s.status === "已入库");
      case "待鉴定":
        return state.specimens.filter((s) => !s.identified);
      case "迁移中":
        return state.specimens.filter((s) => s.frozen);
      default:
        return state.specimens;
    }
  }, [state.specimens, filter]);

  const selected: Specimen | null =
    state.specimens.find((s) => s.id === selectedId) ?? null;

  const run = (result: RuleResult): boolean => {
    if (result.ok) {
      setState(result.state);
      setNotice({ kind: "ok", text: result.message });
    } else {
      // 整次拒绝：不触碰 state，原柜位与队列不变
      setNotice({ kind: "err", text: result.errors.join("；") });
    }
    return result.ok;
  };

  return {
    state,
    queue,
    filter,
    setFilter,
    selected,
    select: setSelectedId,
    notice,
    dismiss: () => setNotice(null),
    apply: (specimenId: string, toCabinetId: string, reason: string) =>
      run(applyMigration(state, specimenId, toCabinetId, reason)),
    receive: (requestId: string, actualCabinetId: string) =>
      run(receiveMigration(state, requestId, actualCabinetId)),
    cancel: (requestId: string) => run(cancelMigration(state, requestId)),
    closeReview: (requestId: string) => run(closeReview(state, requestId)),
    identify: (specimenId: string, identified: boolean) =>
      run(setIdentified(state, specimenId, identified)),
    borrow: (specimenId: string, borrowed: boolean) =>
      run(setBorrowed(state, specimenId, borrowed)),
    intake: (draft: IntakeDraft) => run(intakeSpecimen(state, draft)),
  };
}
