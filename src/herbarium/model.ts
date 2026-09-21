// =============================================================
// 数据模型层：标本、柜位、迁柜台账、差异复核的类型与本地数据
// 旧本地记录按「未迁移」归一化处理，数据持久化在 localStorage，
// 刷新页面后保留（见 loadState / saveState）。
// =============================================================

export type ClimateZone = "常温常湿" | "恒温低湿" | "冷藏低湿";
export type PressStatus = "待压制" | "已压制";
export type IdentifyStatus = "待鉴定" | "已鉴定" | "存疑";
export type LoanStatus = "在馆" | "已借出";
export type SpecimenStage = "queue" | "stored";

export interface CollectionLoc {
  place: string; // 采集地点
  altitude: string; // 海拔
  habitat: string; // 生境描述
}

export interface Cabinet {
  id: string; // 柜位号，如 A-11-01
  zone: ClimateZone; // 温湿度档
  capacity: number; // 柜位容量（份）
}

export interface Specimen {
  id: string;
  collectNo: string; // 采集号
  species: string; // 物种名称
  collector: string; // 采集人
  loc: CollectionLoc;
  press: PressStatus; // 压制状态
  identify: IdentifyStatus; // 鉴定状态
  loan: LoanStatus; // 借阅状态
  stage: SpecimenStage; // queue 入库队列 / stored 已入库
  cabinetId: string | null; // 已入柜后的柜位
  storedAt: number | null;
  hasPhoto: boolean; // 是否已拍照（需补照筛选用）
  createdAt: number;
}

// 迁柜台账状态：
// reserved  迁移中（目标柜位已预留，来源柜继续保留，冻结鉴定/借阅）
// migrated  接收完成
// rejected  申请被整次拒绝（仅历史，不留任何预留）
// cancelled 取消（只释放目标预留）
// returned  接收差异，退回来源柜，等待差异复核结案
export type MigrationStatus =
  | "reserved"
  | "migrated"
  | "rejected"
  | "cancelled"
  | "returned";

export interface MigrationRequest {
  id: string;
  specimenId: string;
  fromCabinetId: string;
  toCabinetId: string;
  zone: ClimateZone; // 申请时锁定的温湿度档快照
  status: MigrationStatus;
  createdAt: number;
  acceptedAt: number | null;
  cancelledAt: number | null;
  note: string;
}

export type DiscrepancyType = "cabinet-mismatch" | "target-occupied";

export interface Discrepancy {
  id: string;
  requestId: string;
  specimenId: string;
  types: DiscrepancyType[]; // 柜位不符 / 目标已占用
  detail: string;
  createdAt: number;
  resolved: boolean;
  resolvedAt: number | null;
  resolutionNote: string;
}

export interface AppState {
  version: number;
  cabinets: Cabinet[];
  specimens: Specimen[];
  requests: MigrationRequest[];
  discrepancies: Discrepancy[];
}

export const STORAGE_VERSION = 1;
export const STORAGE_KEY = "hxyfront-62007-herbarium-v1";

export const CLIMATE_ZONES: ClimateZone[] = ["常温常湿", "恒温低湿", "冷藏低湿"];
export const PRESS_STATUSES: PressStatus[] = ["待压制", "已压制"];
export const IDENTIFY_STATUSES: IdentifyStatus[] = ["待鉴定", "已鉴定", "存疑"];

// 资料完整判定所依赖的字段（拍照与鉴定结论不在「资料完整」范围内）
export const PROFILE_FIELDS: { key: keyof Specimen | "place" | "altitude" | "habitat"; label: string }[] = [
  { key: "collectNo", label: "采集号" },
  { key: "species", label: "物种名称" },
  { key: "collector", label: "采集人" },
  { key: "place", label: "采集地点" },
  { key: "altitude", label: "海拔" },
  { key: "habitat", label: "生境描述" },
];

export function uid(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}${rand}`;
}

function seedState(): AppState {
  const now = Date.now();
  const cabinets: Cabinet[] = [
    { id: "A-11-01", zone: "常温常湿", capacity: 4 },
    { id: "A-11-02", zone: "常温常湿", capacity: 3 },
    { id: "B-05-03", zone: "恒温低湿", capacity: 4 },
    { id: "B-05-04", zone: "恒温低湿", capacity: 2 },
    { id: "C-02-01", zone: "冷藏低湿", capacity: 3 },
  ];

  let seq = 0;
  const mk = (s: Omit<Specimen, "id" | "createdAt">): Specimen => ({
    ...s,
    id: `SP-${String(++seq).padStart(3, "0")}`,
    createdAt: now - (seq + 2) * 3_600_000,
  });

  const specimens: Specimen[] = [
    mk({
      collectNo: "HX-240615-01", species: "槭属待定", collector: "周明远",
      loc: { place: "秦岭光头山", altitude: "1420m", habitat: "针阔混交林林缘" },
      press: "已压制", identify: "待鉴定", loan: "在馆",
      stage: "stored", cabinetId: "A-11-01", storedAt: now - 9 * 86_400_000, hasPhoto: true,
    }),
    mk({
      collectNo: "HX-240615-08", species: "荚果蕨", collector: "林晓",
      loc: { place: "秦岭光头山", altitude: "1380m", habitat: "阴湿沟谷石缝" },
      press: "已压制", identify: "已鉴定", loan: "在馆",
      stage: "stored", cabinetId: "A-11-01", storedAt: now - 9 * 86_400_000, hasPhoto: true,
    }),
    mk({
      collectNo: "HX-240616-03", species: "蒲儿根", collector: "周明远",
      loc: { place: "太白山铁甲泉", altitude: "1650m", habitat: "山坡路边草丛" },
      press: "已压制", identify: "已鉴定", loan: "在馆",
      stage: "stored", cabinetId: "A-11-02", storedAt: now - 8 * 86_400_000, hasPhoto: true,
    }),
    mk({
      collectNo: "HX-240618-11", species: "青扦", collector: "陈芮",
      loc: { place: "太白山放羊寺", altitude: "2800m", habitat: "高山冷杉林下" },
      press: "已压制", identify: "存疑", loan: "在馆",
      stage: "stored", cabinetId: "B-05-03", storedAt: now - 6 * 86_400_000, hasPhoto: true,
    }),
    mk({
      collectNo: "HX-240620-02", species: "薹草属待定", collector: "林晓",
      loc: { place: "佛坪凉风垭", altitude: "1750m", habitat: "箭竹林下湿地" },
      press: "已压制", identify: "待鉴定", loan: "在馆",
      stage: "stored", cabinetId: "B-05-03", storedAt: now - 4 * 86_400_000, hasPhoto: true,
    }),
    // 资料不完整（缺生境描述）的已入库标本：不可申请迁柜
    mk({
      collectNo: "HX-240621-05", species: "杓兰属待定", collector: "陈芮",
      loc: { place: "佛坪凉风垭", altitude: "1900m", habitat: "" },
      press: "已压制", identify: "待鉴定", loan: "在馆",
      stage: "stored", cabinetId: "B-05-04", storedAt: now - 3 * 86_400_000, hasPhoto: false,
    }),
    mk({
      collectNo: "HX-240701-01", species: "报春花属待定", collector: "高原",
      loc: { place: "太白山文公庙", altitude: "3000m", habitat: "高山灌丛草甸" },
      press: "待压制", identify: "待鉴定", loan: "在馆",
      stage: "queue", cabinetId: null, storedAt: null, hasPhoto: false,
    }),
    mk({
      collectNo: "HX-240702-04", species: "毛茛状金莲花", collector: "高原",
      loc: { place: "太文公庙", altitude: "2950m", habitat: "溪畔湿草地" },
      press: "已压制", identify: "待鉴定", loan: "在馆",
      stage: "queue", cabinetId: null, storedAt: null, hasPhoto: true,
    }),
    mk({
      collectNo: "HX-240703-02", species: "峨眉蔷薇", collector: "林晓",
      loc: { place: "佛坪大古坪", altitude: "1520m", habitat: "林缘灌丛" },
      press: "已压制", identify: "已鉴定", loan: "在馆",
      stage: "queue", cabinetId: null, storedAt: null, hasPhoto: false,
    }),
  ];

  return { version: STORAGE_VERSION, cabinets, specimens, requests: [], discrepancies: [] };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : fallback;

function normalizeCabinet(v: unknown): Cabinet | null {
  if (!isRecord(v)) return null;
  const zone = str(v.zone) as ClimateZone;
  if (!CLIMATE_ZONES.includes(zone)) return null;
  const id = str(v.id);
  const capacity = typeof v.capacity === "number" && v.capacity >= 0 ? v.capacity : 0;
  return id ? { id, zone, capacity } : null;
}

function normalizeSpecimen(v: unknown, index: number): Specimen | null {
  if (!isRecord(v)) return null;
  const loc = isRecord(v.loc) ? v.loc : {};
  const press = PRESS_STATUSES.includes(str(v.press) as PressStatus)
    ? (v.press as PressStatus)
    : "待压制";
  const identify = IDENTIFY_STATUSES.includes(str(v.identify) as IdentifyStatus)
    ? (v.identify as IdentifyStatus)
    : "待鉴定";
  const stage: SpecimenStage = v.stage === "stored" ? "stored" : "queue";
  const cabinetId = typeof v.cabinetId === "string" ? v.cabinetId : null;
  return {
    id: str(v.id, `SP-LEGACY-${index + 1}`),
    collectNo: str(v.collectNo),
    species: str(v.species),
    collector: str(v.collector),
    loc: { place: str(loc.place), altitude: str(loc.altitude), habitat: str(loc.habitat) },
    press,
    identify,
    loan: v.loan === "已借出" ? "已借出" : "在馆",
    // 旧记录若无阶段字段：有柜位按已入库，否则留在入库队列
    stage: stage === "stored" || cabinetId ? "stored" : "queue",
    cabinetId: stage === "stored" || cabinetId ? cabinetId : null,
    storedAt: typeof v.storedAt === "number" ? v.storedAt : null,
    hasPhoto: v.hasPhoto === true,
    createdAt: typeof v.createdAt === "number" ? v.createdAt : Date.now(),
  };
}

function normalizeRequest(v: unknown): MigrationRequest | null {
  if (!isRecord(v)) return null;
  const statuses: MigrationStatus[] = ["reserved", "migrated", "rejected", "cancelled", "returned"];
  const status = str(v.status) as MigrationStatus;
  if (!statuses.includes(status)) return null;
  const zone = str(v.zone) as ClimateZone;
  return {
    id: str(v.id, uid("MG")),
    specimenId: str(v.specimenId),
    fromCabinetId: str(v.fromCabinetId),
    toCabinetId: str(v.toCabinetId),
    zone: CLIMATE_ZONES.includes(zone) ? zone : "常温常湿",
    status,
    createdAt: typeof v.createdAt === "number" ? v.createdAt : Date.now(),
    acceptedAt: typeof v.acceptedAt === "number" ? v.acceptedAt : null,
    cancelledAt: typeof v.cancelledAt === "number" ? v.cancelledAt : null,
    note: str(v.note),
  };
}

function normalizeDiscrepancy(v: unknown): Discrepancy | null {
  if (!isRecord(v)) return null;
  const types = Array.isArray(v.types)
    ? (v.types as unknown[]).filter((t): t is DiscrepancyType =>
        t === "cabinet-mismatch" || t === "target-occupied")
    : [];
  return {
    id: str(v.id, uid("DC")),
    requestId: str(v.requestId),
    specimenId: str(v.specimenId),
    types,
    detail: str(v.detail),
    createdAt: typeof v.createdAt === "number" ? v.createdAt : Date.now(),
    resolved: v.resolved === true,
    resolvedAt: typeof v.resolvedAt === "number" ? v.resolvedAt : null,
    resolutionNote: str(v.resolutionNote),
  };
}

// 旧版本本地数据迁移：缺失台账字段的旧标本一律按「未迁移」处理
// （requests / discrepancies 缺省为空，迁移状态由规则层推导为未迁移）。
function migrateState(raw: unknown): AppState {
  if (!isRecord(raw)) return seedState();
  const cabinets = Array.isArray(raw.cabinets)
    ? raw.cabinets.map(normalizeCabinet).filter((c): c is Cabinet => c !== null)
    : [];
  const specimens = Array.isArray(raw.specimens)
    ? raw.specimens.map(normalizeSpecimen).filter((s): s is Specimen => s !== null)
    : [];
  if (cabinets.length === 0 || specimens.length === 0) return seedState();
  const requests = Array.isArray(raw.requests)
    ? raw.requests.map(normalizeRequest).filter((r): r is MigrationRequest => r !== null)
    : [];
  const discrepancies = Array.isArray(raw.discrepancies)
    ? raw.discrepancies.map(normalizeDiscrepancy).filter((d): d is Discrepancy => d !== null)
    : [];
  return { version: STORAGE_VERSION, cabinets, specimens, requests, discrepancies };
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedState();
    return migrateState(JSON.parse(raw));
  } catch {
    return seedState();
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用时静默降级，刷新后回到内置数据
  }
}
