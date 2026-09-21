// 规则层端到端冒烟测试（不入库，仅本地运行）
import {
  STORAGE_KEY,
  type AppState,
} from "../src/herbarium/model";
import {
  applyMigrations,
  cabinetBalance,
  cabinetOccupancy,
  cabinetReserved,
  cancelMigration,
  checkEligibility,
  isSpecimenFrozen,
  migrationPhaseOf,
  receiveMigration,
  resolveDiscrepancy,
} from "../src/herbarium/migrationRules";

// 内存 localStorage 桩，验证旧记录迁移
const mem = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const { loadState, saveState } = await import("../src/herbarium/model");

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    console.error("  ✕ " + msg);
  }
}

// ---- 1. 种子数据与旧记录「未迁移」 ----
let s: AppState = loadState();
const sp1 = s.specimens.find((x) => x.collectNo === "HX-240615-01")!;
assert(s.cabinets.length === 5, "种子：5 个柜位");
assert(migrationPhaseOf(s, sp1.id) === "none", "旧记录按未迁移推导");
const sp6 = s.specimens.find((x) => x.collectNo === "HX-240618-11")!; // B-05-03 -> 恒温低湿

// ---- 2. 资料不完整拒绝 ----
const incomplete = s.specimens.find((x) => x.collectNo === "HX-240621-05")!;
const issue1 = checkEligibility(s, incomplete.id, "B-05-03");
assert(issue1?.kind === "profile-incomplete", "资料不完整标本不可申请");
assert(issue1?.missingFields?.includes("生境描述"), "缺生境描述被指出");

// 队列标本不可申请
const queued = s.specimens.find((x) => x.stage === "queue")!;
assert(checkEligibility(s, queued.id, "A-11-01")?.kind === "not-stored", "未入库标本不可申请");

// 温湿度档不一致
assert(checkEligibility(s, sp1.id, "B-05-03")?.kind === "zone-mismatch", "温湿度档不一致拒绝");
// 同柜
assert(checkEligibility(s, sp1.id, "A-11-01")?.kind === "same-as-source", "目标即来源拒绝");

// ---- 3. 正常申请：同档有余额 A-11-01 -> A-11-02（常温常湿，容量3，已占1，余2）
const balBefore = cabinetBalance(s, "A-11-02");
assert(balBefore === 2, "A-11-02 初始余额 2");
let r = applyMigrations(s, [{ specimenId: sp1.id, targetCabinetId: "A-11-02" }]);
assert(r.ok && r.created.length === 1, "合法申请受理");
s = r.state;
assert(cabinetBalance(s, "A-11-02") === balBefore - 1, "受理后目标柜余额减 1（预留）");
assert(cabinetOccupancy(s, "A-11-01") === 2, "来源柜继续保留（仍占名额）");
assert(isSpecimenFrozen(s, sp1.id), "迁移中冻结");
assert(migrationPhaseOf(s, sp1.id) === "reserved", "迁移中阶段 reserved");
const req1 = r.created[0];

// ---- 4. 同类申请：已有进行中，再申请整次拒绝，且不改变余额
const dup = applyMigrations(s, [{ specimenId: sp1.id, targetCabinetId: "A-11-02" }]);
assert(!dup.ok, "同类申请（已有进行中）整次拒绝");
assert(dup.state === s, "拒绝时返回原状态引用，原柜位与队列不变");
assert(cabinetBalance(s, "A-11-02") === balBefore - 1, "拒绝不占用余额");

// 同批两条同标本 -> 整次拒绝
const sp2 = s.specimens.find((x) => x.collectNo === "HX-240615-08")!;
const dupBatch = applyMigrations(s, [
  { specimenId: sp2.id, targetCabinetId: "A-11-02" },
  { specimenId: sp2.id, targetCabinetId: "A-11-02" },
]);
assert(!dupBatch.ok && dupBatch.errors.some((e) => e.line === 2), "同批同类只保留一条，整次拒绝");

// 批内超配：A-11-02 只剩 1 个余额（被 req1 预留），两条合法但同目标 -> 整次拒绝
const sp3 = s.specimens.find((x) => x.collectNo === "HX-240616-03")!; // 已在 A-11-02
const overbook = applyMigrations(s, [
  { specimenId: sp2.id, targetCabinetId: "A-11-02" },
  // 同档柜位只有 A-11-01/02，用 A-11-01（有余 0：占2/容4 含 sp1 保留来源，实际占2余2）
]);
assert(overbook.ok, "单条占最后余额应通过: " + JSON.stringify(overbook.errors));
s = overbook.state;
const lastBal = cabinetBalance(s, "A-11-02");
assert(lastBal === 0, "A-11-02 余额耗尽");
const overbook2 = applyMigrations(s, [{ specimenId: sp3.id, targetCabinetId: "A-11-02" }]);
// sp3 已在 A-11-02，目标=来源 -> 拒绝（same-as-source），换 A-11-01
assert(checkEligibility(s, sp3.id, "A-11-02")?.kind === "same-as-source", "目标即来源");
// 无余额：另一标本从 A-11-01 迁 A-11-02 已无额
const spX = s.specimens.find((x) => x.collectNo === "HX-240615-08")!;
void spX;

// ---- 5. 冻结鉴定/借阅由 viewState 保证；这里验证冻结态在取消后解除 ----
const req2 = s.requests.find((x) => x.specimenId === sp2.id && x.status === "reserved")!;
const cancel = cancelMigration(s, req2.id);
assert(cancel.ok, "取消成功");
s = cancel.state;
assert(cabinetBalance(s, "A-11-02") === 1, "取消只释放目标预留，余额恢复 1");
assert(cabinetOccupancy(s, "A-11-01") === 2, "取消后来源柜仍保留 sp2");
assert(!isSpecimenFrozen(s, sp2.id), "取消后解冻");
assert(migrationPhaseOf(s, sp2.id) === "cancelled", "取消记录阶段 cancelled");

// ---- 6. 接收差异：柜位不符 -> 退回来源 + 差异复核 + 预留释放 + 未结冻结 ----
const recvBad = receiveMigration(s, {
  requestId: req1.id,
  actualCabinetId: "A-11-01",
  targetOccupied: false,
});
assert(recvBad.ok && !!recvBad.discrepancy, "柜位不符生成差异复核");
s = recvBad.state;
const dc = recvBad.discrepancy!;
assert(dc.types.includes("cabinet-mismatch"), "差异类型 cabinet-mismatch");
assert(s.specimens.find((x) => x.id === sp1.id)?.cabinetId === "A-11-01", "标本退回来源柜");
assert(cabinetReserved(s, "A-11-02") === 0, "差异后目标预留释放");
assert(isSpecimenFrozen(s, sp1.id), "差异未结前继续冻结（不得再迁）");
assert(checkEligibility(s, sp1.id, "A-11-02")?.kind === "open-discrepancy", "未结前申请被 open-discrepancy 拦截");

// 目标已占用
const sp4 = s.specimens.find((x) => x.collectNo === "HX-240618-11")!;
const applyB = applyMigrations(s, [{ specimenId: sp4.id, targetCabinetId: "B-05-04" }]);
// B-05-04 容量2，sp6 占1（杓兰在B-05-04），余1 -> 可申请
assert(applyB.ok, "B-05-04 有余额可申请: " + JSON.stringify(applyB.errors));
s = applyB.state;
const reqB = applyB.created[0];
const recvOcc = receiveMigration(s, { requestId: reqB.id, actualCabinetId: "B-05-04", targetOccupied: true });
assert(recvOcc.ok && recvOcc.discrepancy?.types.includes("target-occupied"), "目标已占用生成差异");
s = recvOcc.state;
assert(s.specimens.find((x) => x.id === sp4.id)?.cabinetId === "B-05-03", "占用差异退回来源");

// ---- 7. 结案后解冻，可重新申请 ----
const resolved = resolveDiscrepancy(s, dc.id, "账实一致");
assert(resolved.ok, "差异复核结案");
s = resolved.state;
assert(!isSpecimenFrozen(s, sp1.id), "结案后解冻");
assert(checkEligibility(s, sp1.id, "A-11-02") === null, "结案后可重新申请");
assert(migrationPhaseOf(s, sp1.id) === "none", "退回结案且无新记录 -> 未迁移");

// ---- 8. 正常接收：标本迁入，来源释放，目标占用增加 ----
const applyAgain = applyMigrations(s, [{ specimenId: sp1.id, targetCabinetId: "A-11-02" }]);
assert(applyAgain.ok, "重新申请受理");
s = applyAgain.state;
const req3 = applyAgain.created[0];
const recvOk = receiveMigration(s, { requestId: req3.id, actualCabinetId: "A-11-02", targetOccupied: false });
assert(recvOk.ok && !recvOk.discrepancy, "正常接收无差异");
s = recvOk.state;
assert(s.specimens.find((x) => x.id === sp1.id)?.cabinetId === "A-11-02", "标本迁入目标柜");
assert(cabinetOccupancy(s, "A-11-01") === 1, "来源柜占用随迁出释放（只剩 sp2）");
assert(!isSpecimenFrozen(s, sp1.id), "接收后解冻");
assert(migrationPhaseOf(s, sp1.id) === "migrated", "阶段 migrated");

// ---- 9. 恒温低湿标本正常迁移（sp6 青扦 B-05-03，需先结案占用差异）----
const dcB = s.discrepancies.find((x) => x.requestId === reqB.id && !x.resolved)!;
s = resolveDiscrepancy(s, dcB.id, "重新安排").state;
const applyB2 = applyMigrations(s, [{ specimenId: sp4.id, targetCabinetId: "B-05-04" }]);
assert(applyB2.ok, "结案后恒温柜可再申请");
s = applyB2.state;
s = receiveMigration(s, { requestId: applyB2.created[0].id, actualCabinetId: "B-05-04", targetOccupied: false }).state;
assert(s.specimens.find((x) => x.id === sp4.id)?.cabinetId === "B-05-04", "恒温柜迁移完成");

// ---- 10. 持久化与旧数据迁移 ----
saveState(s);
const reloaded = loadState();
assert(reloaded.specimens.length === s.specimens.length, "刷新后标本数保留");
assert(reloaded.requests.length === s.requests.length, "台账记录刷新保留");
assert(reloaded.discrepancies.length === s.discrepancies.length, "差异记录刷新保留");

// 模拟旧版本数据（无 requests/discrepancies/version）
mem.set(
  STORAGE_KEY,
  JSON.stringify({
    cabinets: [
      { id: "OLD-1", zone: "常温常湿", capacity: 2 },
      { id: "OLD-2", zone: "错误档位", capacity: 2 },
    ],
    specimens: [
      { id: "old-a", collectNo: "OLD-01", species: "旧种", stage: "stored", cabinetId: "OLD-1" },
      { id: "old-b", collectNo: "OLD-02", species: "旧种2", cabinetId: "OLD-1" },
      { collectNo: "NO-ID", species: "无名" },
    ],
  }),
);
const migrated = loadState();
assert(migrated.version === 1, "旧数据升级版本号");
assert(migrated.cabinets.length === 1, "非法柜位被过滤");
assert(migrated.specimens.some((x) => x.id === "old-a"), "旧标本保留");
assert(migrated.specimens.some((x) => x.id.startsWith("SP-LEGACY-")), "缺 id 旧记录补 id");
assert(
  migrated.specimens.find((x) => x.collectNo === "OLD-02")?.stage === "stored" &&
    migrated.specimens.find((x) => x.collectNo === "OLD-02")?.cabinetId === "OLD-1",
  "有柜位的旧记录归一为已入库",
);
const noId = migrated.specimens.find((x) => x.species === "无名");
assert(noId?.stage === "queue" && noId?.cabinetId === null, "无柜位旧记录归入入库队列");
assert(migrated.requests.length === 0 && migrated.discrepancies.length === 0, "旧记录台账为空=全部未迁移");
assert(migrationPhaseOf(migrated, "old-a") === "none", "旧标本按未迁移");
assert(
  migrated.specimens.every((x) => typeof x.hasPhoto === "boolean" && x.loc),
  "旧记录补齐缺省字段",
);

console.log(`\n${fail === 0 ? "全部通过" : "有失败"}：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
