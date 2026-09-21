// 工作台：入库队列、鉴定状态筛选、采集地点信息卡
import { useMemo, useState } from "react";
import type { HerbariumStore } from "./viewState";
import { IDENTIFY_STATUSES, PRESS_STATUSES, type IdentifyStatus, type Specimen } from "./model";
import { Badge, identifyTone, loanTone, pressTone, MIGRATION_LABEL } from "./ui";
import { cabinetBalance } from "./migrationRules";

function SpecimenRow({ store, specimen }: { store: HerbariumStore; specimen: Specimen }) {
  const { cabinetMap, frozenIds, phaseMap, openDiscrepancyIds, openDetail, shelve, setTab } = store;
  const [shelveCabinet, setShelveCabinet] = useState(store.state.cabinets[0]?.id ?? "");
  const frozen = frozenIds.has(specimen.id);
  const phase = phaseMap.get(specimen.id) ?? "none";
  const discrepancyOpen = openDiscrepancyIds.has(specimen.id);

  return (
    <article className="spec-card">
      <div className="spec-main" onClick={() => openDetail(specimen.id)}>
        <div className="spec-title">
          <h3>{specimen.collectNo}</h3>
          <span className="species">{specimen.species}</span>
        </div>
        <p className="spec-sub">
          {specimen.loc.place || "未填采集地点"}
          {specimen.loc.altitude ? ` · ${specimen.loc.altitude}` : ""}
          {specimen.collector ? ` · 采集人 ${specimen.collector}` : ""}
        </p>
        <div className="spec-badges">
          <Badge tone={pressTone(specimen.press)}>{specimen.press}</Badge>
          <Badge tone={identifyTone(specimen.identify)}>{specimen.identify}</Badge>
          <Badge tone={loanTone(specimen.loan)}>{specimen.loan}</Badge>
          {!specimen.hasPhoto && <Badge tone="amber">需补照</Badge>}
          {frozen && <Badge tone="amber">迁移中·已冻结鉴定/借阅</Badge>}
          {phase === "returned" && <Badge tone="red">{MIGRATION_LABEL.returned}</Badge>}
          {phase === "migrated" && <Badge tone="green">{MIGRATION_LABEL.migrated}</Badge>}
          {phase === "cancelled" && <Badge tone="gray">{MIGRATION_LABEL.cancelled}</Badge>}
          {discrepancyOpen && <Badge tone="red">差异待复核</Badge>}
        </div>
      </div>
      <div className="spec-side">
        {specimen.stage === "queue" ? (
          <>
            <select value={shelveCabinet} onChange={(e) => setShelveCabinet(e.target.value)}>
              {store.state.cabinets.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id}（{c.zone}·余 {cabinetBalance(store.state, c.id)}）
                </option>
              ))}
            </select>
            <button
              disabled={specimen.press !== "已压制"}
              title={specimen.press !== "已压制" ? "待压制标本不能上柜" : "写入柜位记录"}
              onClick={() => {
                const result = shelve(specimen.id, shelveCabinet);
                if (!result.ok && result.error) store.pushToast("error", result.error);
              }}
            >
              上柜
            </button>
          </>
        ) : (
          <>
            <button
              className="link-btn"
              onClick={() => {
                setTab("cabinets");
              }}
            >
              {cabinetMap.get(specimen.cabinetId ?? "")?.id ?? "柜位缺失"}
            </button>
            <button onClick={() => openDetail(specimen.id)}>详情</button>
          </>
        )}
      </div>
    </article>
  );
}

function IntakeForm({ store }: { store: HerbariumStore }) {
  const { intakeDraft, setIntakeDraft, addToQueue } = store;
  const update = <K extends keyof typeof intakeDraft>(key: K, value: (typeof intakeDraft)[K]) =>
    setIntakeDraft({ ...intakeDraft, [key]: value });

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>专业字段</p>
          <h2>新增标本入库</h2>
        </div>
        <span className="hint">保存后进入入库队列，压制完成即可上柜</span>
      </div>
      <div className="field-grid">
        <label>
          <span>采集号 *</span>
          <input
            value={intakeDraft.collectNo}
            placeholder="如 HX-240705-01"
            onChange={(e) => update("collectNo", e.target.value)}
          />
        </label>
        <label>
          <span>物种名称 *</span>
          <input
            value={intakeDraft.species}
            placeholder="如 槭属待定"
            onChange={(e) => update("species", e.target.value)}
          />
        </label>
        <label>
          <span>采集人</span>
          <input
            value={intakeDraft.collector}
            placeholder="采集人姓名"
            onChange={(e) => update("collector", e.target.value)}
          />
        </label>
        <label>
          <span>采集地点</span>
          <input
            value={intakeDraft.place}
            placeholder="如 秦岭光头山"
            onChange={(e) => update("place", e.target.value)}
          />
        </label>
        <label>
          <span>海拔</span>
          <input
            value={intakeDraft.altitude}
            placeholder="如 1420m"
            onChange={(e) => update("altitude", e.target.value)}
          />
        </label>
        <label>
          <span>生境描述</span>
          <input
            value={intakeDraft.habitat}
            placeholder="如 针阔混交林林缘"
            onChange={(e) => update("habitat", e.target.value)}
          />
        </label>
        <label>
          <span>压制状态</span>
          <select value={intakeDraft.press} onChange={(e) => update("press", e.target.value as Specimen["press"])}>
            {PRESS_STATUSES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          <span>鉴定状态</span>
          <select
            value={intakeDraft.identify}
            onChange={(e) => update("identify", e.target.value as IdentifyStatus)}
          >
            {IDENTIFY_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="checkline">
        <input
          type="checkbox"
          checked={intakeDraft.hasPhoto}
          onChange={(e) => update("hasPhoto", e.target.checked)}
        />
        <span>已拍照</span>
      </label>
      <button
        className="primary"
        onClick={() => {
          const result = addToQueue(intakeDraft);
          if (!result.ok && result.error) store.pushToast("error", result.error);
        }}
      >
        保存到入库队列
      </button>
    </section>
  );
}

export default function Workbench({ store }: { store: HerbariumStore }) {
  const { state, filteredSpecimens, stageFilter, setStageFilter, identifyFilter, setIdentifyFilter, flagFilter, setFlagFilter } =
    store;

  // 采集地点信息卡：按地点聚合
  const locCards = useMemo(() => {
    const map = new Map<string, { place: string; altitude: string; habitat: string; count: number }>();
    state.specimens.forEach((s) => {
      if (!s.loc.place) return;
      const key = s.loc.place;
      const prev = map.get(key);
      if (prev) {
        prev.count += 1;
        if (!prev.altitude && s.loc.altitude) prev.altitude = s.loc.altitude;
        if (!prev.habitat && s.loc.habitat) prev.habitat = s.loc.habitat;
      } else {
        map.set(key, { place: key, altitude: s.loc.altitude, habitat: s.loc.habitat, count: 1 });
      }
    });
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [state.specimens]);

  const queueCount = state.specimens.filter((s) => s.stage === "queue").length;
  const storedCount = state.specimens.filter((s) => s.stage === "stored").length;
  const pendingIdentify = state.specimens.filter((s) => s.identify === "待鉴定").length;
  const reservedCount = state.requests.filter((r) => r.status === "reserved").length;

  return (
    <div className="view-stack">
      <section className="metrics">
        <article>
          <small>入库队列</small>
          <strong>{queueCount}</strong>
        </article>
        <article>
          <small>待鉴定</small>
          <strong>{pendingIdentify}</strong>
        </article>
        <article>
          <small>已上柜</small>
          <strong>{storedCount}</strong>
        </article>
        <article>
          <small>采集点</small>
          <strong>{locCards.length}</strong>
        </article>
      </section>

      <section className="workspace">
        <aside className="panel filter-panel">
          <h2>筛选</h2>
          <p className="filter-group">阶段</p>
          <div className="chips">
            {(
              [
                ["all", "全部"],
                ["queue", "入库队列"],
                ["stored", "已入库"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                className={stageFilter === key ? "chip-on" : ""}
                onClick={() => setStageFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="filter-group">鉴定状态</p>
          <div className="chips">
            <button className={identifyFilter === "all" ? "chip-on" : ""} onClick={() => setIdentifyFilter("all")}>
              全部
            </button>
            {IDENTIFY_STATUSES.map((s) => (
              <button key={s} className={identifyFilter === s ? "chip-on" : ""} onClick={() => setIdentifyFilter(s)}>
                {s}
              </button>
            ))}
          </div>
          <p className="filter-group">标记</p>
          <div className="chips">
            {(
              [
                ["all", "全部"],
                ["need-press", "待压制"],
                ["need-photo", "需补照"],
              ] as const
            ).map(([key, label]) => (
              <button key={key} className={flagFilter === key ? "chip-on" : ""} onClick={() => setFlagFilter(key)}>
                {label}
              </button>
            ))}
          </div>
          <p className="filter-note">进行中迁柜 {reservedCount} 份，鉴定与借阅已冻结。</p>
        </aside>

        <IntakeForm store={store} />
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>标本列表</p>
            <h2>入库队列与已入库标本（{filteredSpecimens.length}）</h2>
          </div>
          <span className="hint">点击标本行查看单份详情</span>
        </div>
        <div className="spec-list">
          {filteredSpecimens.length === 0 && <p className="empty">当前筛选下没有标本。</p>}
          {filteredSpecimens.map((s) => (
            <SpecimenRow key={s.id} store={store} specimen={s} />
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>采集地点信息卡</p>
            <h2>采集地点聚合</h2>
          </div>
        </div>
        <div className="loc-grid">
          {locCards.map((card) => (
            <article key={card.place} className="loc-card">
              <h3>{card.place}</h3>
              <p>
                {card.altitude || "海拔未登记"} · {card.habitat || "生境未登记"}
              </p>
              <Badge tone="teal">{card.count} 份标本</Badge>
            </article>
          ))}
          {locCards.length === 0 && <p className="empty">暂无采集地点信息。</p>}
        </div>
      </section>
    </div>
  );
}
