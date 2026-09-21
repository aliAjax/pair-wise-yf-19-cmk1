// 迁移规则：申请、接收、取消、复核结案及冻结约束的纯函数校验与状态迁移

import {
  HerbariumState,
  MigrationRequest,
  Specimen,
  isProfileComplete,
  remainingCapacity,
} from "./model";

export type RuleResult =
  | { ok: true; state: HerbariumState; message: string }
  | { ok: false; errors: string[] };

const fail = (errors: string[]): RuleResult => ({ ok: false, errors });
const pass = (state: HerbariumState, message: string): RuleResult => ({ ok: true, state, message });

function clone(state: HerbariumState): HerbariumState {
  return {
    specimens: state.specimens.map((s) => ({ ...s })),
    cabinets: state.cabinets.map((c) => ({ ...c, occupants: [...c.occupants] })),
    migrations: state.migrations.map((m) => ({ ...m, review: m.review ? { ...m.review } : null })),
  };
}

function now(): string {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

/**
 * 申请迁柜：仅已入库且资料完整的标本可申请；目标柜位温湿度档一致且有余额；
 * 同类申请只保留一条；任一校验失败则整次拒绝，原柜位与队列不变。
 */
export function applyMigration(
  state: HerbariumState,
  specimenId: string,
  toCabinetId: string,
  reason: string
): RuleResult {
  const errors: string[] = [];
  const specimen = state.specimens.find((s) => s.id === specimenId);
  if (!specimen) return fail(["标本不存在"]);

  if (specimen.status !== "已入库") errors.push("仅已入库标本可申请迁柜");
  if (!isProfileComplete(specimen)) errors.push("标本资料不完整，需补齐字段并完成压制");
  if (specimen.frozen) errors.push("标本处于迁移冻结中");

  const hasPending = state.migrations.some(
    (m) => m.specimenId === specimenId && m.status === "待接收"
  );
  if (hasPending) errors.push("同类申请只保留一条，该标本已有待接收申请");

  const hasOpenReview = state.migrations.some(
    (m) => m.specimenId === specimenId && m.review?.open
  );
  if (hasOpenReview) errors.push("存在未结差异复核，结案前不得再迁");

  const from = state.cabinets.find((c) => c.id === specimen.cabinetId);
  if (!from) errors.push("原柜位不存在");

  const target = state.cabinets.find((c) => c.id === toCabinetId);
  if (!target) {
    errors.push("目标柜位不存在");
  } else {
    if (from && target.id === from.id) errors.push("目标柜位不能与原柜位相同");
    if (from && target.climate !== from.climate)
      errors.push(`温湿度档不一致：${from.climate} → ${target.climate}`);
    if (target.reservedBy) errors.push(`目标柜位已被 ${target.reservedBy} 预留`);
    if (remainingCapacity(target) <= 0) errors.push("目标柜位无余额");
  }

  if (errors.length > 0) return fail(errors); // 整次拒绝，state 原样返回

  const next = clone(state);
  next.cabinets.find((c) => c.id === toCabinetId)!.reservedBy = specimenId;
  next.specimens.find((s) => s.id === specimenId)!.frozen = true;
  const request: MigrationRequest = {
    id: `MV-${String(next.migrations.length + 1).padStart(3, "0")}`,
    specimenId,
    fromCabinetId: from!.id,
    toCabinetId,
    reason: reason.trim() || "柜位调整",
    status: "待接收",
    appliedAt: now(),
    review: null,
  };
  next.migrations = [request, ...next.migrations];
  return pass(next, `已受理 ${specimenId} 的迁柜申请，目标柜位 ${toCabinetId} 已预留`);
}

/**
 * 接收：柜位不符或目标已占用则退回来源并生成差异复核，未结前不得再迁；
 * 正常接收后来源柜出柜、目标柜入柜，解除预留与冻结。
 */
export function receiveMigration(
  state: HerbariumState,
  requestId: string,
  actualCabinetId: string
): RuleResult {
  const request = state.migrations.find((m) => m.id === requestId);
  if (!request) return fail(["迁移申请不存在"]);
  if (request.status !== "待接收") return fail(["仅待接收申请可办理接收"]);

  const target = state.cabinets.find((c) => c.id === request.toCabinetId);
  const actual = actualCabinetId.trim();
  const mismatch = actual !== request.toCabinetId;
  const occupied =
    !target || target.reservedBy !== request.specimenId || target.occupants.length >= target.capacity;

  const next = clone(state);
  const req = next.migrations.find((m) => m.id === requestId)!;
  const sp = next.specimens.find((s) => s.id === request.specimenId)!;
  const tgt = next.cabinets.find((c) => c.id === request.toCabinetId);

  if (mismatch || occupied) {
    // 退回来源：释放目标预留，来源柜继续保留，生成差异复核
    if (tgt && tgt.reservedBy === request.specimenId) tgt.reservedBy = null;
    sp.frozen = false;
    req.status = "已退回";
    req.review = {
      id: `RV-${req.id.slice(3)}`,
      cause: mismatch ? "柜位不符" : "目标已占用",
      note: mismatch
        ? `实收柜位 ${actual || "（空）"} 与申请柜位 ${request.toCabinetId} 不一致`
        : `目标柜位 ${request.toCabinetId} 已无可用余额`,
      open: true,
    };
    return pass(next, `接收异常，已退回来源柜 ${request.fromCabinetId} 并生成差异复核 ${req.review.id}`);
  }

  const src = next.cabinets.find((c) => c.id === request.fromCabinetId);
  if (src) src.occupants = src.occupants.filter((id) => id !== request.specimenId);
  tgt!.reservedBy = null;
  tgt!.occupants = [...tgt!.occupants, request.specimenId];
  sp.cabinetId = tgt!.id;
  sp.frozen = false;
  req.status = "已完成";
  return pass(next, `${request.specimenId} 已迁入 ${tgt!.id}，来源柜 ${request.fromCabinetId} 已释放`);
}

/** 取消：只释放目标预留，来源柜位与队列不变 */
export function cancelMigration(state: HerbariumState, requestId: string): RuleResult {
  const request = state.migrations.find((m) => m.id === requestId);
  if (!request) return fail(["迁移申请不存在"]);
  if (request.status !== "待接收") return fail(["仅待接收申请可取消"]);

  const next = clone(state);
  next.migrations.find((m) => m.id === requestId)!.status = "已取消";
  const tgt = next.cabinets.find((c) => c.id === request.toCabinetId);
  if (tgt && tgt.reservedBy === request.specimenId) tgt.reservedBy = null;
  next.specimens.find((s) => s.id === request.specimenId)!.frozen = false;
  return pass(next, `已取消 ${requestId}，目标柜位预留已释放`);
}

/** 差异复核结案：结案后才可再次申请迁柜 */
export function closeReview(state: HerbariumState, requestId: string): RuleResult {
  const request = state.migrations.find((m) => m.id === requestId);
  if (!request || !request.review) return fail(["差异复核不存在"]);
  if (!request.review.open) return fail(["该复核已结案"]);

  const next = clone(state);
  next.migrations.find((m) => m.id === requestId)!.review!.open = false;
  return pass(next, `${request.review.id} 已结案，可重新申请迁柜`);
}

/** 鉴定状态变更：迁移冻结期间禁止 */
export function setIdentified(
  state: HerbariumState,
  specimenId: string,
  identified: boolean
): RuleResult {
  const specimen = state.specimens.find((s) => s.id === specimenId);
  if (!specimen) return fail(["标本不存在"]);
  if (specimen.frozen) return fail(["迁移中，鉴定已冻结"]);

  const next = clone(state);
  next.specimens.find((s) => s.id === specimenId)!.identified = identified;
  return pass(next, identified ? `${specimenId} 已标记鉴定完成` : `${specimenId} 已退回待鉴定`);
}

/** 借阅登记/归还：迁移冻结期间禁止 */
export function setBorrowed(
  state: HerbariumState,
  specimenId: string,
  borrowed: boolean
): RuleResult {
  const specimen = state.specimens.find((s) => s.id === specimenId);
  if (!specimen) return fail(["标本不存在"]);
  if (specimen.frozen) return fail(["迁移中，借阅已冻结"]);

  const next = clone(state);
  next.specimens.find((s) => s.id === specimenId)!.borrowed = borrowed;
  return pass(next, borrowed ? `${specimenId} 已登记借阅` : `${specimenId} 已归还`);
}

export interface IntakeDraft {
  id: string;
  species: string;
  location: string;
  altitude: string;
  habitat: string;
  collector: string;
  cabinetId: string;
}

/** 新增记录：默认进入入库队列；填写馆藏位置且柜位有余额时直接入柜 */
export function intakeSpecimen(state: HerbariumState, draft: IntakeDraft): RuleResult {
  const errors: string[] = [];
  const id = draft.id.trim();
  if (!id) errors.push("采集号必填");
  if (state.specimens.some((s) => s.id === id)) errors.push("采集号已存在");
  if (!draft.species.trim()) errors.push("物种名称必填");

  const cabinetId = draft.cabinetId.trim();
  const cabinet = cabinetId ? state.cabinets.find((c) => c.id === cabinetId) : null;
  if (cabinetId && !cabinet) errors.push("馆藏柜位不存在");
  if (cabinet && remainingCapacity(cabinet) <= 0) errors.push("馆藏柜位无余额");

  if (errors.length > 0) return fail(errors);

  const altitude = draft.altitude.trim() ? Number(draft.altitude) : null;
  const specimen: Specimen = {
    id,
    species: draft.species.trim(),
    location: draft.location.trim(),
    altitude: altitude !== null && !Number.isNaN(altitude) ? altitude : null,
    habitat: draft.habitat.trim(),
    collector: draft.collector.trim(),
    pressed: false,
    identified: false,
    borrowed: false,
    status: cabinet ? "已入库" : "待入库",
    cabinetId: cabinet ? cabinet.id : null,
    frozen: false,
  };

  const next = clone(state);
  next.specimens = [specimen, ...next.specimens];
  if (cabinet) {
    const c = next.cabinets.find((x) => x.id === cabinet.id)!;
    c.occupants = [...c.occupants, specimen.id];
  }
  return pass(next, `${id} 已登记${cabinet ? `，直接入柜 ${cabinet.id}` : "，进入入库队列"}`);
}
