// =============================================================
// 视图状态层：领域数据（持久化到 localStorage）+ 纯视图状态，
// 以及柜位记录、详情页与本地数据同步所需的全部动作。
// 迁柜判定本身全部委托 migrationRules，本文件只做状态编排。
// =============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IDENTIFY_STATUSES,
  PRESS_STATUSES,
  STORAGE_KEY,
  loadState,
  saveState,
  uid,
  type AppState,
  type Cabinet,
  type IdentifyStatus,
  type PressStatus,
  type Specimen,
} from "./model";
import {
  applyMigrations,
  cancelMigration,
  checkEligibility,
  isSpecimenFrozen,
  migrationPhaseOf,
  receiveMigration,
  resolveDiscrepancy,
  type ApplyLineDraft,
  type ApplyLineError,
  type ReceiveInput,
} from "./migrationRules";

export type ViewTab = "workbench" | "cabinets" | "ledger";

export interface Toast {
  id: string;
  kind: "ok" | "error";
  text: string;
}

export interface IntakeDraft {
  collectNo: string;
  species: string;
  collector: string;
  place: string;
  altitude: string;
  habitat: string;
  press: PressStatus;
  identify: IdentifyStatus;
  hasPhoto: boolean;
  cabinetId: string;
}

export interface ApplyLineState extends ApplyLineDraft {
  key: string;
}

export interface ReceiveDraft extends ReceiveInput {
  requestId: string;
}

export const emptyIntakeDraft = (): IntakeDraft => ({
  collectNo: "",
  species: "",
  collector: "",
  place: "",
  altitude: "",
  habitat: "",
  press: "待压制",
  identify: "待鉴定",
  hasPhoto: false,
  cabinetId: "",
});

function newApplyLine(cabinets: Cabinet[], specimenId = ""): ApplyLineState {
  return { key: uid("line"), specimenId, targetCabinetId: cabinets[0]?.id ?? "" };
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export function useHerbarium() {
  const [state, setState] = useState<AppState>(loadState);
  const stateRef = useRef(state);
  stateRef.current = state;

  // 本地数据同步：每次领域数据变更都写回 localStorage，刷新保留
  useEffect(() => {
    saveState(state);
  }, [state]);

  // ---- 纯视图状态（不持久化） ----
  const [tab, setTab] = useState<ViewTab>("workbench");
  const [stageFilter, setStageFilter] = useState<"all" | "queue" | "stored">("all");
  const [identifyFilter, setIdentifyFilter] = useState<"all" | IdentifyStatus>("all");
  const [flagFilter, setFlagFilter] = useState<"all" | "need-press" | "need-photo">("all");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [intakeDraft, setIntakeDraft] = useState<IntakeDraft>(emptyIntakeDraft);
  const [applyLines, setApplyLines] = useState<ApplyLineState[]>([]);
  const [applyErrors, setApplyErrors] = useState<ApplyLineError[]>([]);
  const [receiveDraft, setReceiveDraft] = useState<ReceiveDraft | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const pushToast = useCallback((kind: Toast["kind"], text: string) => {
    const id = uid("toast");
    setToasts((prev) => [...prev, { id, kind, text }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  // 进入迁柜台账时保证至少有一行申请
  const ensureApplyLines = useCallback(() => {
    setApplyLines((prev) =>
      prev.length > 0 ? prev : [newApplyLine(stateRef.current.cabinets)],
    );
  }, []);

  const openDetail = useCallback((id: string) => {
    setDetailId(id);
  }, []);

  const closeDetail = useCallback(() => setDetailId(null), []);

  // ----------------------------------------------------------------
  // 入库队列：新增 → 保存到入库队列；上柜 → 写入柜位记录（需有余额）
  // ----------------------------------------------------------------

  const addToQueue = useCallback(
    (draft: IntakeDraft): ActionResult => {
      if (!draft.collectNo.trim() || !draft.species.trim()) {
        return { ok: false, error: "采集号和物种名称为必填项" };
      }
      const specimen: Specimen = {
        id: uid("SP"),
        collectNo: draft.collectNo.trim(),
        species: draft.species.trim(),
        collector: draft.collector.trim(),
        loc: {
          place: draft.place.trim(),
          altitude: draft.altitude.trim(),
          habitat: draft.habitat.trim(),
        },
        press: draft.press,
        identify: draft.identify,
        loan: "在馆",
        stage: "queue",
        cabinetId: null,
        storedAt: null,
        hasPhoto: draft.hasPhoto,
        createdAt: Date.now(),
      };
      setState((prev) => ({ ...prev, specimens: [specimen, ...prev.specimens] }));
      setIntakeDraft(emptyIntakeDraft());
      pushToast("ok", `采集号 ${specimen.collectNo} 已进入入库队列`);
      return { ok: true };
    },
    [pushToast],
  );

  const shelve = useCallback(
    (specimenId: string, cabinetId: string): ActionResult => {
      const current = stateRef.current;
      const specimen = current.specimens.find((s) => s.id === specimenId);
      if (!specimen) return { ok: false, error: "标本不存在" };
      if (specimen.stage === "stored") return { ok: false, error: "标本已在柜位上" };
      if (specimen.press !== "已压制") return { ok: false, error: "标本尚未压制完成，不能上柜" };
      const cabinet = current.cabinets.find((c) => c.id === cabinetId);
      if (!cabinet) return { ok: false, error: "请选择目标柜位" };
      const occupied = current.specimens.filter(
        (s) => s.stage === "stored" && s.cabinetId === cabinetId,
      ).length;
      const reserved = current.requests.filter(
        (r) => r.status === "reserved" && r.toCabinetId === cabinetId,
      ).length;
      if (cabinet.capacity - occupied - reserved <= 0) {
        return { ok: false, error: `柜位 ${cabinetId} 已无余额（含迁移预留）` };
      }
      setState((prev) => ({
        ...prev,
        specimens: prev.specimens.map((s) =>
          s.id === specimenId
            ? { ...s, stage: "stored", cabinetId, storedAt: Date.now() }
            : s,
        ),
      }));
      pushToast("ok", `${specimen.collectNo} 已上柜 ${cabinetId}`);
      return { ok: true };
    },
    [pushToast],
  );

  // ----------------------------------------------------------------
  // 鉴定与借阅：迁移中冻结
  // ----------------------------------------------------------------

  const setIdentify = useCallback(
    (specimenId: string, identify: IdentifyStatus, note?: string): ActionResult => {
      const current = stateRef.current;
      if (isSpecimenFrozen(current, specimenId)) {
        return { ok: false, error: "迁移中已冻结鉴定，迁柜结束后再操作" };
      }
      setState((prev) => ({
        ...prev,
        specimens: prev.specimens.map((s) => (s.id === specimenId ? { ...s, identify } : s)),
      }));
      pushToast("ok", `鉴定状态已更新为「${identify}」${note ? `：${note}` : ""}`);
      return { ok: true };
    },
    [pushToast],
  );

  const toggleLoan = useCallback(
    (specimenId: string): ActionResult => {
      const current = stateRef.current;
      const specimen = current.specimens.find((s) => s.id === specimenId);
      if (!specimen) return { ok: false, error: "标本不存在" };
      if (specimen.stage !== "stored") return { ok: false, error: "只有已入库标本可以借阅" };
      if (isSpecimenFrozen(current, specimenId)) {
        return { ok: false, error: "迁移中已冻结借阅，迁柜结束后再操作" };
      }
      const loan = specimen.loan === "在馆" ? "已借出" : "在馆";
      setState((prev) => ({
        ...prev,
        specimens: prev.specimens.map((s) => (s.id === specimenId ? { ...s, loan } : s)),
      }));
      pushToast("ok", `${specimen.collectNo} 借阅状态：${loan}`);
      return { ok: true };
    },
    [pushToast],
  );

  const togglePhoto = useCallback((specimenId: string) => {
    setState((prev) => ({
      ...prev,
      specimens: prev.specimens.map((s) => (s.id === specimenId ? { ...s, hasPhoto: !s.hasPhoto } : s)),
    }));
  }, []);

  // ----------------------------------------------------------------
  // 迁柜申请、接收、取消、差异复核
  // ----------------------------------------------------------------

  const submitApply = useCallback(
    (lines: ApplyLineState[]): ActionResult => {
      const payload: ApplyLineDraft[] = lines
        .filter((l) => l.specimenId && l.targetCabinetId)
        .map(({ specimenId, targetCabinetId }) => ({ specimenId, targetCabinetId }));
      const result = applyMigrations(stateRef.current, payload);
      if (!result.ok) {
        setApplyErrors(result.errors);
        pushToast("error", `整次拒绝：${result.errors.length} 条申请行未通过校验，原柜位与队列不变`);
        return { ok: false, error: "申请未通过校验" };
      }
      setState(result.state);
      setApplyErrors([]);
      setApplyLines([newApplyLine(stateRef.current.cabinets)]);
      pushToast("ok", `已受理 ${result.created.length} 条迁柜申请，目标柜位已预留`);
      return { ok: true };
    },
    [pushToast],
  );

  const receive = useCallback(
    (draft: ReceiveDraft): ActionResult => {
      const result = receiveMigration(stateRef.current, draft);
      if (!result.ok) {
        pushToast("error", result.error ?? "接收失败");
        return { ok: false, error: result.error };
      }
      setState(result.state);
      setReceiveDraft(null);
      if (result.discrepancy) {
        pushToast("error", "接收差异：已退回来源柜并生成差异复核，未结前不得再迁");
      } else {
        pushToast("ok", "接收完成，标本已迁入目标柜位");
      }
      return { ok: true };
    },
    [pushToast],
  );

  const cancel = useCallback(
    (requestId: string): ActionResult => {
      const result = cancelMigration(stateRef.current, requestId);
      if (!result.ok) {
        pushToast("error", result.error ?? "取消失败");
        return { ok: false, error: result.error };
      }
      setState(result.state);
      pushToast("ok", "申请已取消，目标柜位预留已释放，标本仍在来源柜");
      return { ok: true };
    },
    [pushToast],
  );

  const resolve = useCallback(
    (discrepancyId: string, note: string): ActionResult => {
      const result = resolveDiscrepancy(stateRef.current, discrepancyId, note);
      if (!result.ok) {
        pushToast("error", result.error ?? "复核失败");
        return { ok: false, error: result.error };
      }
      setState(result.state);
      pushToast("ok", "差异复核已结案，标本恢复正常，可重新申请迁柜");
      return { ok: true };
    },
    [pushToast],
  );

  const resetLocal = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    window.location.reload();
  }, []);

  // ----------------------------------------------------------------
  // 派生数据
  // ----------------------------------------------------------------

  const specimenMap = useMemo(() => {
    const map = new Map<string, Specimen>();
    state.specimens.forEach((s) => map.set(s.id, s));
    return map;
  }, [state.specimens]);

  const cabinetMap = useMemo(() => {
    const map = new Map<string, Cabinet>();
    state.cabinets.forEach((c) => map.set(c.id, c));
    return map;
  }, [state.cabinets]);

  const frozenIds = useMemo(
    () => new Set(state.specimens.map((s) => s.id).filter((id) => isSpecimenFrozen(state, id))),
    [state],
  );

  const phaseMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof migrationPhaseOf>>();
    state.specimens.forEach((s) => map.set(s.id, migrationPhaseOf(state, s.id)));
    return map;
  }, [state]);

  const openDiscrepancyIds = useMemo(
    () => new Set(state.discrepancies.filter((d) => !d.resolved).map((d) => d.specimenId)),
    [state.discrepancies],
  );

  const filteredSpecimens = useMemo(() => {
    return state.specimens.filter((s) => {
      if (stageFilter !== "all" && s.stage !== stageFilter) return false;
      if (identifyFilter !== "all" && s.identify !== identifyFilter) return false;
      if (flagFilter === "need-press" && s.press !== "待压制") return false;
      if (flagFilter === "need-photo" && s.hasPhoto) return false;
      return true;
    });
  }, [state.specimens, stageFilter, identifyFilter, flagFilter]);

  const lineHints = useMemo(() => {
    return applyLines.map((line) => {
      if (!line.specimenId || !line.targetCabinetId) {
        return { ok: false, message: "请选择标本与目标柜位" };
      }
      const issue = checkEligibility(state, line.specimenId, line.targetCabinetId);
      return issue
        ? { ok: false, message: issue.message, missingFields: issue.missingFields }
        : { ok: true, message: "资格校验通过" };
    });
  }, [applyLines, state]);

  return {
    state,
    // 视图状态
    tab,
    setTab,
    stageFilter,
    setStageFilter,
    identifyFilter,
    setIdentifyFilter,
    flagFilter,
    setFlagFilter,
    detailId,
    openDetail,
    closeDetail,
    intakeDraft,
    setIntakeDraft,
    applyLines,
    setApplyLines,
    applyErrors,
    setApplyErrors,
    receiveDraft,
    setReceiveDraft,
    toasts,
    pushToast,
    ensureApplyLines,
    newApplyLine: () => newApplyLine(state.cabinets),
    // 动作
    addToQueue,
    shelve,
    setIdentify,
    toggleLoan,
    togglePhoto,
    submitApply,
    receive,
    cancel,
    resolve,
    resetLocal,
    // 派生
    specimenMap,
    cabinetMap,
    frozenIds,
    phaseMap,
    openDiscrepancyIds,
    filteredSpecimens,
    lineHints,
  };
}

export type HerbariumStore = ReturnType<typeof useHerbarium>;

export { PRESS_STATUSES, IDENTIFY_STATUSES };
