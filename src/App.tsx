import { FormEvent, useState } from "react";
import "./styles.css";
import {
  CabinetSlot,
  MigrationRequest,
  Specimen,
  isProfileComplete,
  remainingCapacity,
} from "./migration/model";
import { QUEUE_FILTERS, useMigrationView } from "./migration/viewState";

const project = {
  id: "hxyfront-62007",
  sourceNo: 9,
  port: 62007,
  title: "植物标本馆入库",
  prompt:
    "开发一个植物标本馆压制标本入库前端项目，工作人员可以录入采集号、物种名称、采集地点、海拔、生境描述、采集人、压制状态、鉴定状态和馆藏位置。页面需要有入库队列、鉴定状态筛选、采集地点信息卡、馆藏柜位记录和单份标本详情页。",
};

const STATUS_CLASS: Record<MigrationRequest["status"], string> = {
  待接收: "badge warn",
  已完成: "badge ok",
  已取消: "badge mute",
  已退回: "badge err",
};

function ReceiveControls({
  request,
  onReceive,
  onCancel,
}: {
  request: MigrationRequest;
  onReceive: (actual: string) => void;
  onCancel: () => void;
}) {
  const [actual, setActual] = useState(request.toCabinetId);
  return (
    <div className="receive-controls">
      <input
        value={actual}
        onChange={(e) => setActual(e.target.value)}
        placeholder="实收柜位编号"
        aria-label="实收柜位编号"
      />
      <button className="primary" onClick={() => onReceive(actual)}>
        确认接收
      </button>
      <button onClick={onCancel}>取消申请</button>
    </div>
  );
}

function ApplyForm({
  specimen,
  cabinets,
  onApply,
}: {
  specimen: Specimen;
  cabinets: CabinetSlot[];
  onApply: (toCabinetId: string, reason: string) => boolean;
}) {
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const eligible = specimen.status === "已入库" && isProfileComplete(specimen) && !specimen.frozen;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (onApply(target, reason)) {
      setTarget("");
      setReason("");
    }
  };

  if (!eligible) {
    const why: string[] = [];
    if (specimen.status !== "已入库") why.push("未入库");
    if (!isProfileComplete(specimen)) why.push("资料不完整");
    if (specimen.frozen) why.push("迁移冻结中");
    return <p className="hint">暂不可申请迁柜：{why.join("、")}。</p>;
  }

  return (
    <form className="apply-form" onSubmit={submit}>
      <label>
        <span>目标柜位（需温湿度档一致且有余额）</span>
        <select value={target} onChange={(e) => setTarget(e.target.value)} required>
          <option value="" disabled>
            选择目标柜位
          </option>
          {cabinets
            .filter((c) => c.id !== specimen.cabinetId)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} · {c.climate} · 余额 {remainingCapacity(c)}
              </option>
            ))}
        </select>
      </label>
      <label>
        <span>迁移原因</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="如：防治虫害、密集架调整"
        />
      </label>
      <button className="primary" type="submit">
        提交迁柜申请
      </button>
    </form>
  );
}

function App() {
  const view = useMigrationView();
  const { state, queue, selected, notice } = view;
  const [draft, setDraft] = useState({
    id: "",
    species: "",
    location: "",
    altitude: "",
    habitat: "",
    collector: "",
    cabinetId: "",
  });

  const pendingOf = (specimenId: string) =>
    state.migrations.find((m) => m.specimenId === specimenId && m.status === "待接收");
  const openReviewOf = (specimenId: string) =>
    state.migrations.find((m) => m.specimenId === specimenId && m.review?.open);

  const metrics = [
    { label: "入库队列", value: state.specimens.filter((s) => s.status === "待入库").length },
    { label: "待鉴定", value: state.specimens.filter((s) => !s.identified).length },
    { label: "已上柜", value: state.specimens.filter((s) => s.cabinetId).length },
    { label: "迁移中", value: state.migrations.filter((m) => m.status === "待接收").length },
  ];

  const submitIntake = (e: FormEvent) => {
    e.preventDefault();
    if (view.intake(draft)) {
      setDraft({ id: "", species: "", location: "", altitude: "", habitat: "", collector: "", cabinetId: "" });
    }
  };

  return (
    <main className="app">
      <section className="hero">
        <p>
          {project.id} · 源提示词{project.sourceNo} · Port {project.port}
        </p>
        <h1>{project.title}</h1>
        <span>{project.prompt}</span>
      </section>

      {notice && (
        <div className={`notice ${notice.kind}`} role="status">
          <span>{notice.text}</span>
          <button onClick={view.dismiss}>知道了</button>
        </div>
      )}

      <section className="metrics">
        {metrics.map((metric) => (
          <article key={metric.label}>
            <small>{metric.label}</small>
            <strong>{metric.value}</strong>
          </article>
        ))}
      </section>

      <section className="workspace">
        <aside className="panel">
          <h2>鉴定状态筛选</h2>
          <div className="chips">
            {QUEUE_FILTERS.map((item) => (
              <button
                key={item}
                className={view.filter === item ? "active" : ""}
                onClick={() => view.setFilter(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <h2 className="queue-title">入库队列</h2>
          <div className="queue">
            {queue.map((s) => (
              <button
                key={s.id}
                className={`queue-item ${selected?.id === s.id ? "active" : ""}`}
                onClick={() => view.select(s.id)}
              >
                <b>{s.id}</b>
                <span>
                  {s.species} · {s.location}
                </span>
                <small>
                  {s.status}
                  {s.identified ? " · 已鉴定" : " · 待鉴定"}
                  {s.frozen ? " · 冻结中" : ""}
                  {s.cabinetId ? ` · ${s.cabinetId}` : ""}
                </small>
              </button>
            ))}
            {queue.length === 0 && <p className="hint">当前筛选下暂无标本。</p>}
          </div>
        </aside>

        <section className="panel">
          {selected ? (
            <>
              <div className="heading">
                <div>
                  <p>标本详情页</p>
                  <h2>
                    {selected.id} · {selected.species}
                  </h2>
                </div>
                <div className="badges">
                  <span className={`badge ${selected.status === "已入库" ? "ok" : "mute"}`}>
                    {selected.status}
                  </span>
                  {selected.frozen && <span className="badge warn">迁移冻结中</span>}
                  {selected.borrowed && <span className="badge warn">借阅中</span>}
                </div>
              </div>

              <div className="detail-grid">
                <div>
                  <small>采集地点</small>
                  <b>{selected.location || "—"}</b>
                </div>
                <div>
                  <small>海拔</small>
                  <b>{selected.altitude !== null ? `${selected.altitude} m` : "—"}</b>
                </div>
                <div>
                  <small>生境描述</small>
                  <b>{selected.habitat || "—"}</b>
                </div>
                <div>
                  <small>采集人</small>
                  <b>{selected.collector || "—"}</b>
                </div>
                <div>
                  <small>压制状态</small>
                  <b>{selected.pressed ? "已压制" : "待压制"}</b>
                </div>
                <div>
                  <small>鉴定状态</small>
                  <b>{selected.identified ? "已鉴定" : "待鉴定"}</b>
                </div>
                <div>
                  <small>馆藏位置</small>
                  <b>{selected.cabinetId ?? "未上柜"}</b>
                </div>
                <div>
                  <small>资料完整</small>
                  <b>{isProfileComplete(selected) ? "完整" : "缺失"}</b>
                </div>
              </div>

              <div className="actions">
                <button
                  disabled={selected.frozen}
                  title={selected.frozen ? "迁移中，鉴定已冻结" : ""}
                  onClick={() => view.identify(selected.id, !selected.identified)}
                >
                  {selected.identified ? "退回待鉴定" : "标记已鉴定"}
                </button>
                <button
                  disabled={selected.frozen}
                  title={selected.frozen ? "迁移中，借阅已冻结" : ""}
                  onClick={() => view.borrow(selected.id, !selected.borrowed)}
                >
                  {selected.borrowed ? "登记归还" : "登记借阅"}
                </button>
              </div>

              {openReviewOf(selected.id) && (
                <div className="review-card">
                  <b>差异复核 {openReviewOf(selected.id)!.review!.id}（未结）</b>
                  <p>
                    {openReviewOf(selected.id)!.review!.cause}：
                    {openReviewOf(selected.id)!.review!.note}
                  </p>
                  <p className="hint">结案前该标本不得再次申请迁柜。</p>
                  <button onClick={() => view.closeReview(openReviewOf(selected.id)!.id)}>
                    复核结案
                  </button>
                </div>
              )}

              {pendingOf(selected.id) ? (
                <div className="pending-card">
                  <b>
                    待接收申请 {pendingOf(selected.id)!.id}：{pendingOf(selected.id)!.fromCabinetId} →{" "}
                    {pendingOf(selected.id)!.toCabinetId}
                  </b>
                  <p className="hint">
                    迁移中冻结鉴定与借阅，来源柜继续保留；接收时柜位不符或目标已占用将退回来源。
                  </p>
                  <ReceiveControls
                    request={pendingOf(selected.id)!}
                    onReceive={(actual) => view.receive(pendingOf(selected.id)!.id, actual)}
                    onCancel={() => view.cancel(pendingOf(selected.id)!.id)}
                  />
                </div>
              ) : (
                !openReviewOf(selected.id) && (
                  <ApplyForm
                    specimen={selected}
                    cabinets={state.cabinets}
                    onApply={(to, reason) => view.apply(selected.id, to, reason)}
                  />
                )
              )}
            </>
          ) : (
            <div className="empty-detail">
              <h2>单份标本详情页</h2>
              <p className="hint">从左侧入库队列选择一份标本，查看详情并办理迁柜。</p>
            </div>
          )}
        </section>
      </section>

      <section className="panel form-panel">
        <div className="heading">
          <div>
            <p>专业字段</p>
            <h2>新增记录</h2>
          </div>
          <button className="primary" form="intake-form" type="submit">
            保存记录
          </button>
        </div>
        <form id="intake-form" className="field-grid" onSubmit={submitIntake}>
          {(
            [
              ["id", "采集号"],
              ["species", "物种名称"],
              ["location", "采集地点"],
              ["altitude", "海拔"],
              ["habitat", "生境描述"],
              ["collector", "采集人"],
              ["cabinetId", "馆藏位置（选填柜位号）"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <span>{label}</span>
              <input
                value={draft[key]}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                placeholder={`填写${label}`}
              />
            </label>
          ))}
        </form>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>馆藏柜位记录</p>
            <h2>柜位占用与预留</h2>
          </div>
        </div>
        <div className="cabinets">
          {state.cabinets.map((c) => (
            <article key={c.id} className="cabinet-card">
              <div className="cabinet-head">
                <b>{c.id}</b>
                <span className="badge mute">{c.climate}</span>
              </div>
              <div className="capacity-bar" title={`容量 ${c.capacity}`}>
                <i style={{ width: `${(c.occupants.length / c.capacity) * 100}%` }} />
                {c.reservedBy && <em style={{ width: `${(1 / c.capacity) * 100}%` }} />}
              </div>
              <p>
                在柜 {c.occupants.length} / {c.capacity} · 余额 {remainingCapacity(c)}
                {c.reservedBy && <span className="badge warn">预留 {c.reservedBy}</span>}
              </p>
              <ul>
                {c.occupants.map((id) => (
                  <li key={id}>
                    <button className="link" onClick={() => view.select(id)}>
                      {id}
                    </button>
                  </li>
                ))}
                {c.occupants.length === 0 && <li className="hint">空柜</li>}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>柜位迁移台账</p>
            <h2>迁移申请与差异复核</h2>
          </div>
          <span className="badge mute">{state.migrations.length} 条记录</span>
        </div>
        <div className="records">
          {state.migrations.map((m) => (
            <article key={m.id} className="ledger-row">
              <div className="ledger-main">
                <h3>
                  {m.id} ·{" "}
                  <button className="link" onClick={() => view.select(m.specimenId)}>
                    {m.specimenId}
                  </button>
                </h3>
                <p>
                  {m.fromCabinetId} → {m.toCabinetId} · {m.reason} · {m.appliedAt}
                </p>
                {m.review && (
                  <p className={m.review.open ? "review-open" : "hint"}>
                    差异复核 {m.review.id}（{m.review.open ? "未结" : "已结案"}）：{m.review.cause}，
                    {m.review.note}
                  </p>
                )}
              </div>
              <div className="ledger-side">
                <span className={STATUS_CLASS[m.status]}>{m.status}</span>
                {m.status === "待接收" && (
                  <ReceiveControls
                    request={m}
                    onReceive={(actual) => view.receive(m.id, actual)}
                    onCancel={() => view.cancel(m.id)}
                  />
                )}
                {m.review?.open && <button onClick={() => view.closeReview(m.id)}>复核结案</button>}
              </div>
            </article>
          ))}
          {state.migrations.length === 0 && (
            <p className="hint">暂无迁移记录。已入库且资料完整的标本可在详情页申请迁柜。</p>
          )}
        </div>
      </section>
    </main>
  );
}

export default App;
