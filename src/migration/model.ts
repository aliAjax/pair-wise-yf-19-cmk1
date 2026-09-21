// 数据模型：标本、柜位、迁移台账的类型定义、种子数据与本地持久化

export type ClimateGrade = "常温低湿" | "恒温恒湿" | "低温低湿";
export type SpecimenStatus = "待入库" | "已入库";
export type MigrationStatus = "待接收" | "已完成" | "已取消" | "已退回";

export interface Specimen {
  id: string; // 采集号
  species: string; // 物种名称
  location: string; // 采集地点
  altitude: number | null; // 海拔(m)
  habitat: string; // 生境描述
  collector: string; // 采集人
  pressed: boolean; // 压制状态
  identified: boolean; // 鉴定状态
  borrowed: boolean; // 借阅中
  status: SpecimenStatus;
  cabinetId: string | null; // 馆藏位置
  frozen: boolean; // 迁移中：冻结鉴定与借阅
}

export interface CabinetSlot {
  id: string; // 柜位编号
  climate: ClimateGrade; // 温湿度档
  capacity: number; // 容量
  occupants: string[]; // 在柜标本采集号
  reservedBy: string | null; // 迁移预留的标本采集号
}

export interface DiscrepancyReview {
  id: string;
  cause: "柜位不符" | "目标已占用";
  note: string;
  open: boolean; // 未结前不得再迁
}

export interface MigrationRequest {
  id: string;
  specimenId: string;
  fromCabinetId: string;
  toCabinetId: string;
  reason: string;
  status: MigrationStatus;
  appliedAt: string;
  review: DiscrepancyReview | null;
}

export interface HerbariumState {
  specimens: Specimen[];
  cabinets: CabinetSlot[];
  migrations: MigrationRequest[];
}

/** 柜位余额 = 容量 - 在柜 - 预留 */
export function remainingCapacity(cabinet: CabinetSlot): number {
  return cabinet.capacity - cabinet.occupants.length - (cabinet.reservedBy ? 1 : 0);
}

/** 资料完整：关键字段齐全且已压制 */
export function isProfileComplete(s: Specimen): boolean {
  return Boolean(
    s.species.trim() &&
      s.location.trim() &&
      s.habitat.trim() &&
      s.collector.trim() &&
      s.altitude !== null &&
      s.pressed
  );
}

const STORAGE_KEY = "hxyfront-62007:herbarium";

function seedState(): HerbariumState {
  return {
    cabinets: [
      { id: "A-01-01", climate: "恒温恒湿", capacity: 3, occupants: ["HX-240615-01", "HX-240615-08"], reservedBy: null },
      { id: "A-01-02", climate: "恒温恒湿", capacity: 2, occupants: [], reservedBy: null },
      { id: "B-12-04", climate: "常温低湿", capacity: 3, occupants: ["HX-240616-03", "HX-240617-02"], reservedBy: null },
      { id: "B-12-05", climate: "常温低湿", capacity: 2, occupants: [], reservedBy: null },
      { id: "C-03-01", climate: "低温低湿", capacity: 2, occupants: [], reservedBy: null },
    ],
    specimens: [
      { id: "HX-240615-01", species: "槭属待定 Acer sp.", location: "云南大理苍山", altitude: 1420, habitat: "常绿阔叶林下阴湿沟边", collector: "李岚", pressed: true, identified: false, borrowed: false, status: "已入库", cabinetId: "A-01-01", frozen: false },
      { id: "HX-240615-08", species: "鳞毛蕨属 Dryopteris sp.", location: "云南高黎贡山", altitude: 1850, habitat: "阴湿沟谷", collector: "王溯", pressed: true, identified: true, borrowed: false, status: "已入库", cabinetId: "A-01-01", frozen: false },
      { id: "HX-240616-03", species: "飞蓬属 Erigeron sp.", location: "四川贡嘎山", altitude: 2980, habitat: "高山灌丛草甸", collector: "李岚", pressed: true, identified: true, borrowed: false, status: "已入库", cabinetId: "B-12-04", frozen: false },
      { id: "HX-240617-02", species: "杜鹃花属 Rhododendron sp.", location: "西藏林芝色季拉山", altitude: 3300, habitat: "", collector: "陈默", pressed: true, identified: false, borrowed: false, status: "已入库", cabinetId: "B-12-04", frozen: false },
      { id: "HX-240618-05", species: "报春花属 Primula sp.", location: "云南白马雪山", altitude: 3900, habitat: "流石滩", collector: "王溯", pressed: false, identified: false, borrowed: false, status: "待入库", cabinetId: null, frozen: false },
      { id: "HX-240618-09", species: "龙胆属 Gentiana sp.", location: "青海年宝玉则", altitude: 4020, habitat: "高山草甸", collector: "李岚", pressed: true, identified: false, borrowed: false, status: "待入库", cabinetId: null, frozen: false },
    ],
    migrations: [],
  };
}

/** 旧记录按未迁移处理：补齐迁移相关字段，历史数据默认空台账、未冻结 */
type LegacySpecimen = Omit<Specimen, "borrowed" | "frozen"> &
  Partial<Pick<Specimen, "borrowed" | "frozen">>;
type LegacyCabinet = Omit<CabinetSlot, "reservedBy"> &
  Partial<Pick<CabinetSlot, "reservedBy">>;
type LegacyMigration = Omit<MigrationRequest, "review"> &
  Partial<Pick<MigrationRequest, "review">>;

interface LegacyState {
  specimens?: LegacySpecimen[];
  cabinets?: LegacyCabinet[];
  migrations?: LegacyMigration[];
}

function normalize(raw: LegacyState): HerbariumState {
  return {
    specimens: (raw.specimens ?? []).map((s) => ({ borrowed: false, frozen: false, ...s })),
    cabinets: (raw.cabinets ?? []).map((c) => ({ reservedBy: null, ...c })),
    migrations: (raw.migrations ?? []).map((m) => ({ review: null, ...m })),
  };
}

export function loadState(): HerbariumState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedState();
    return normalize(JSON.parse(raw) as LegacyState);
  } catch {
    return seedState();
  }
}

export function saveState(state: HerbariumState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用时静默降级，页面状态仍保留在内存中
  }
}
