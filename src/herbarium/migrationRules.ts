// =============================================================
// 迁柜业务规则层（纯函数，不依赖 React / localStorage）
//
// 规则总览：
// 1. 仅「已入库且资料完整」的标本可申请迁柜；
// 2. 目标柜位温湿度档必须与来源一致，且有剩余容量（预留占余额）；
// 3. 同类申请只保留一条：同标本存在进行中申请，或同批重复，整次拒绝，
//    原柜位与队列不变；
// 4. 迁移中（reserved）冻结鉴定与借阅，来源柜继续保留（仍占来源名额）；
// 5. 接收时柜位不符或目标已占用：退回来源柜、释放目标预留，
//    生成差异复核；差异未结案前不得再迁；
// 6. 取消只释放目标预留，标本仍在来源柜；
// 7. 迁移状态对旧记录按「未迁移」推导。
// =============================================================

import type {
  AppState,
  Cabinet,
  ClimateZone,
  Discrepancy,
  DiscrepancyType,
  MigrationRequest,
  Specimen,
} from "./model";
import { uid } from "./model";

// ------------------------------------------------------------------
// 柜位容量：已入柜且未迁离的标本占用；reserved 预留占用目标柜余额。
// ------------------------------------------------------------------

export function cabinetOccupancy(state: AppState, cabinetId: string): number {
  return state.specimens.filter((s) => s.stage === "stored" && s.cabinetId === cabinetId).length;
}

export function cabinetReserved(state: AppState, cabinetId: string): number {
  return state.requests.filter(
    (r) => r.status === "reserved" && r.toCabinetId === cabinetId,
  ).length;
}

export function cabinetBalance(state: AppState, cabinetId: string): number {
  const cabinet = state.cabinets.find((c) => c.id === cabinetId);
  if (!cabinet) return 0;
  return cabinet.capacity - cabinetOccupancy(state, cabinetId) - cabinetReserved(state, cabinetId);
}

// ------------------------------------------------------------------
// 进行中申请与差异：reserved 全程进行中；returned 差异未结前同样进行中
// ------------------------------------------------------------------

export function activeRequestFor(state: AppState, specimenId: string): MigrationRequest | undefined {
  return state.requests.find((r) => {
    if (r.specimenId !== specimenId) return false;
    if (r.status === "reserved") return true;
    // 差异退回：差异未结前仍是进行中（不得再迁、继续冻结）；结案后解冻
    if (r.status === "returned") return openDiscrepancyFor(state, specimenId) !== undefined;
    return false;
  });
}

export function openDiscrepancyFor(state: AppState, specimenId: string): Discrepancy | undefined {
  return state.discrepancies.find((d) => d.specimenId === specimenId && !d.resolved);
}

/** 迁移中冻结鉴定与借阅：reserved 直接冻结；
 *  returned 标本差异未结前同样冻结（不得再迁，也不允许鉴定/借阅动作插队）。 */
export function isSpecimenFrozen(state: AppState, specimenId: string): boolean {
  return activeRequestFor(state, specimenId) !== undefined;
}

// ------------------------------------------------------------------
// 申请资格
// ------------------------------------------------------------------

export type IssueKind =
  | "not-stored"
  | "profile-incomplete"
  | "frozen"
  | "open-discrepancy"
  | "target-missing"
  | "zone-mismatch"
  | "no-balance"
  | "same-as-source"
  | "specimen-missing";

export interface ProfileIssue {
  kind: IssueKind;
  message: string;
  missingFields?: string[];
}

export function missingProfileFields(specimen: Specimen): string[] {
  const missing: string[] = [];
  if (!specimen.collectNo.trim()) missing.push("采集号");
  if (!specimen.species.trim()) missing.push("物种名称");
  if (!specimen.collector.trim()) missing.push("采集人");
  if (!specimen.loc.place.trim()) missing.push("采集地点");
  if (!specimen.loc.altitude.trim()) missing.push("海拔");
  if (!specimen.loc.habitat.trim()) missing.push("生境描述");
  return missing;
}

const ISSUE_MESSAGE: Record<IssueKind, string> = {
  "not-stored": "标本尚未入库，只有已入库标本可以申请迁柜",
  "profile-incomplete": "资料不完整，补齐后才能申请迁柜",
  frozen: "存在进行中的迁柜申请，迁移中不得重复申请",
  "open-discrepancy": "差异复核未结案，结案前不得再迁",
  "target-missing": "目标柜位不存在",
  "zone-mismatch": "目标柜位温湿度档与来源柜不一致",
  "no-balance": "目标柜位没有剩余容量",
  "same-as-source": "目标柜位与来源柜位相同",
  "specimen-missing": "标本不存在",
};

export function checkEligibility(
  state: AppState,
  specimenId: string,
  targetCabinetId: string,
): ProfileIssue | null {
  const specimen = state.specimens.find((s) => s.id === specimenId);
  if (!specimen) return { kind: "specimen-missing", message: ISSUE_MESSAGE["specimen-missing"] };

  if (specimen.stage !== "stored" || !specimen.cabinetId) {
    return { kind: "not-stored", message: ISSUE_MESSAGE["not-stored"] };
  }
  const missing = missingProfileFields(specimen);
  if (specimen.press !== "已压制" || missing.length > 0) {
    return {
      kind: "profile-incomplete",
      message: ISSUE_MESSAGE["profile-incomplete"],
      missingFields: specimen.press !== "已压制" ? ["压制完成", ...missing] : missing,
    };
  }
  if (openDiscrepancyFor(state, specimen.id)) {
    return { kind: "open-discrepancy", message: ISSUE_MESSAGE["open-discrepancy"] };
  }
  if (activeRequestFor(state, specimen.id)) {
    return { kind: "frozen", message: ISSUE_MESSAGE["frozen"] };
  }

  const source = state.cabinets.find((c) => c.id === specimen.cabinetId);
  const target = state.cabinets.find((c) => c.id === targetCabinetId);
  if (!target) return { kind: "target-missing", message: ISSUE_MESSAGE["target-missing"] };
  if (target.id === specimen.cabinetId) {
    return { kind: "same-as-source", message: ISSUE_MESSAGE["same-as-source"] };
  }
  if (source && source.zone !== target.zone) {
    return { kind: "zone-mismatch", message: ISSUE_MESSAGE["zone-mismatch"] };
  }
  if (cabinetBalance(state, target.id) <= 0) {
    return { kind: "no-balance", message: ISSUE_MESSAGE["no-balance"] };
  }
  return null;
}

// ------------------------------------------------------------------
// 批量申请：同类申请只保留一条，任何一条不合法则整次拒绝
// ------------------------------------------------------------------

export interface ApplyLineDraft {
  specimenId: string;
  targetCabinetId: string;
}

export interface ApplyLineError {
  line: number;
  message: string;
  missingFields?: string[];
}

export interface ApplyResult {
  ok: boolean;
  state: AppState;
  created: MigrationRequest[];
  errors: ApplyLineError[];
}

export function applyMigrations(state: AppState, lines: ApplyLineDraft[]): ApplyResult {
  if (lines.length === 0) {
    return { ok: false, state, created: [], errors: [{ line: 0, message: "没有可提交的申请行" }] };
  }

  const errors: ApplyLineError[] = [];

  // 同批内同类申请去重：同一标本只允许出现一条
  const seen = new Map<string, number>();
  lines.forEach((line, index) => {
    const prev = seen.get(line.specimenId);
    if (prev !== undefined) {
      errors.push({
        line: index + 1,
        message: `与第 ${prev} 行为同类申请（同一标本），同类申请只保留一条，整次拒绝`,
      });
    } else {
      seen.set(line.specimenId, index + 1);
    }
  });

  // 逐条做资格校验；同批已通过的申请先以 reserved 计入工作副本，
  // 使目标柜余额按批内预留累计，防止同一柜位在同一批中超配。
  let work: AppState = state;
  lines.forEach((line, index) => {
    if (!line.specimenId || !line.targetCabinetId) {
      errors.push({ line: index + 1, message: "申请行缺少标本或目标柜位" });
      return;
    }
    if (seen.get(line.specimenId) !== index + 1) return; // 重复行已登记
    const issue = checkEligibility(work, line.specimenId, line.targetCabinetId);
    if (issue) {
      errors.push({ line: index + 1, message: issue.message, missingFields: issue.missingFields });
      return;
    }
    work = {
      ...work,
      requests: [
        {
          id: `__batch_probe_${index}`,
          specimenId: line.specimenId,
          fromCabinetId: "__probe__",
          toCabinetId: line.targetCabinetId,
          zone: "常温常湿",
          status: "reserved" as const,
          createdAt: 0,
          acceptedAt: null,
          cancelledAt: null,
          note: "",
        },
        ...work.requests,
      ],
    };
  });

  // 任一不合法：整次拒绝，原柜位与队列不变
  if (errors.length > 0) {
    errors.sort((a, b) => a.line - b.line);
    return { ok: false, state, created: [], errors };
  }

  const now = Date.now();
  const created: MigrationRequest[] = lines.map((line) => {
    const specimen = state.specimens.find((s) => s.id === line.specimenId)!;
    const target = state.cabinets.find((c) => c.id === line.targetCabinetId)!;
    return {
      id: uid("MG"),
      specimenId: line.specimenId,
      fromCabinetId: specimen.cabinetId!,
      toCabinetId: line.targetCabinetId,
      zone: target.zone,
      status: "reserved",
      createdAt: now,
      acceptedAt: null,
      cancelledAt: null,
      note: "申请受理，目标柜位已预留",
    };
  });

  // 标本不动：来源柜继续保留，仅追加台账（目标柜余额因 reserved 被占用）
  return {
    ok: true,
    state: { ...state, requests: [...created, ...state.requests] },
    created,
    errors: [],
  };
}

// ------------------------------------------------------------------
// 接收：核对实物柜位与目标占用情况
// ------------------------------------------------------------------

export interface ReceiveInput {
  requestId: string;
  /** 实物实际送到的柜位（与申请目标不一致即「柜位不符」） */
  actualCabinetId: string;
  /** 目标柜位已被其他实物占用 */
  targetOccupied: boolean;
}

export interface ReceiveResult {
  ok: boolean;
  state: AppState;
  request?: MigrationRequest;
  discrepancy?: Discrepancy;
  error?: string;
}

function patchRequest(state: AppState, requestId: string, patch: Partial<MigrationRequest>): MigrationRequest[] {
  return state.requests.map((r) => (r.id === requestId ? { ...r, ...patch } : r));
}

export function receiveMigration(state: AppState, input: ReceiveInput): ReceiveResult {
  const req = state.requests.find((r) => r.id === input.requestId);
  if (!req) return { ok: false, state, error: "台账记录不存在" };
  if (req.status !== "reserved") return { ok: false, state, error: "只有迁移中的申请可以接收" };

  const types: DiscrepancyType[] = [];
  if (input.actualCabinetId !== req.toCabinetId) types.push("cabinet-mismatch");
  if (input.targetOccupied) types.push("target-occupied");

  const now = Date.now();

  // 柜位不符或目标已占用：退回来源柜，释放目标预留，生成差异复核
  if (types.length > 0) {
    const discrepancy: Discrepancy = {
      id: uid("DC"),
      requestId: req.id,
      specimenId: req.specimenId,
      types,
      detail:
        `接收核对差异：${types.includes("cabinet-mismatch") ? `实物柜位 ${input.actualCabinetId || "未登记"} 与目标 ${req.toCabinetId} 不符` : ""}` +
        (types.length === 2 ? "；" : "") +
        `${types.includes("target-occupied") ? `目标柜位 ${req.toCabinetId} 已被占用` : ""}。已退回来源柜 ${req.fromCabinetId}。`,
      createdAt: now,
      resolved: false,
      resolvedAt: null,
      resolutionNote: "",
    };
    return {
      ok: true,
      state: {
        ...state,
        requests: patchRequest(state, req.id, {
          status: "returned",
          acceptedAt: now,
          note: "接收差异：退回来源柜，等待差异复核",
        }),
        discrepancies: [discrepancy, ...state.discrepancies],
      },
      request: { ...req, status: "returned", acceptedAt: now },
      discrepancy,
    };
  }

  // 正常接收：标本迁入目标柜；reserved 转 migrated 后目标预留释放、
  // 来源柜占用也随标本离开而释放。
  const specimens = state.specimens.map((s) =>
    s.id === req.specimenId ? { ...s, cabinetId: req.toCabinetId, storedAt: s.storedAt ?? now } : s,
  );
  return {
    ok: true,
    state: {
      ...state,
      specimens,
      requests: patchRequest(state, req.id, {
        status: "migrated",
        acceptedAt: now,
        note: `接收完成：${req.fromCabinetId} → ${req.toCabinetId}`,
      }),
    },
    request: { ...req, status: "migrated", acceptedAt: now },
  };
}

// ------------------------------------------------------------------
// 取消：只释放目标预留（reserved 记录关闭），标本仍在来源柜
// ------------------------------------------------------------------

export function cancelMigration(
  state: AppState,
  requestId: string,
  reason = "工作人员取消",
): { ok: boolean; state: AppState; error?: string } {
  const req = state.requests.find((r) => r.id === requestId);
  if (!req) return { ok: false, state, error: "台账记录不存在" };
  if (req.status !== "reserved") {
    return { ok: false, state, error: "只有迁移中的申请可以取消" };
  }
  const now = Date.now();
  return {
    ok: true,
    state: {
      ...state,
      requests: patchRequest(state, requestId, {
        status: "cancelled",
        cancelledAt: now,
        note: `已取消，仅释放目标柜 ${req.toCabinetId} 预留（${reason}）`,
      }),
    },
  };
}

// ------------------------------------------------------------------
// 差异复核结案：解冻，标本保持在退回时的来源柜，之后可以重新申请
// ------------------------------------------------------------------

export function resolveDiscrepancy(
  state: AppState,
  discrepancyId: string,
  note: string,
): { ok: boolean; state: AppState; error?: string } {
  const discrepancy = state.discrepancies.find((d) => d.id === discrepancyId);
  if (!discrepancy) return { ok: false, state, error: "差异记录不存在" };
  if (discrepancy.resolved) return { ok: false, state, error: "差异已结案" };

  const now = Date.now();
  return {
    ok: true,
    state: {
      ...state,
      discrepancies: state.discrepancies.map((d) =>
        d.id === discrepancyId
          ? { ...d, resolved: true, resolvedAt: now, resolutionNote: note || "复核确认无误" }
          : d,
      ),
      requests: patchRequest(state, discrepancy.requestId, {
        note: "差异复核已结案，标本在来源柜恢复正常",
      }),
    },
  };
}

// ------------------------------------------------------------------
// 迁移状态推导（含旧记录「未迁移」）
// ------------------------------------------------------------------

export type MigrationPhase =
  | "none" // 未迁移 / 旧记录
  | "reserved" // 迁移中
  | "migrated" // 已迁移
  | "cancelled" // 已取消
  | "returned"; // 差异退回

export function migrationPhaseOf(state: AppState, specimenId: string): MigrationPhase {
  const active = activeRequestFor(state, specimenId);
  if (active) return active.status === "returned" ? "returned" : "reserved";
  const latestClosed = state.requests.find(
    (r) => r.specimenId === specimenId && (r.status === "migrated" || r.status === "cancelled"),
  );
  if (latestClosed) {
    // 被退回并结案后若再无新记录，视为未迁移，可重新申请
    return latestClosed.status === "migrated" ? "migrated" : "cancelled";
  }
  return "none";
}

export function cabinetZoneOf(state: AppState, cabinetId: string | null): ClimateZone | null {
  if (!cabinetId) return null;
  const cabinet: Cabinet | undefined = state.cabinets.find((c) => c.id === cabinetId);
  return cabinet ? cabinet.zone : null;
}
