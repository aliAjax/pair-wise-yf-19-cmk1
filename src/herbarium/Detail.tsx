// 单份标本详情：资料完整性、柜位与迁移履历、鉴定/借阅（迁移中冻结）
import { useMemo } from "react";
import type { HerbariumStore } from "./viewState";
import { IDENTIFY_STATUSES } from "./model";
import {
  DISCREPANCY_LABEL,
  Badge,
  MIGRATION_LABEL,
  formatDate,
  identifyTone,
  loanTone,
  migrationTone,
  pressTone,
} from "./ui";
import { isSpecimenFrozen, missingProfileFields, migrationPhaseOf } from "./migrationRules";

export default function Detail({ store }: { store: HerbariumStore }) {
  const { detailId, closeDetail } = store;
  const specimen = detailId ? store.specimenMap.get(detailId) : undefined;

  const requests = useMemo(() => {
    if (!detailId) return [];
    return store.state.requests
      .filter((r) => r.specimenId === detailId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [detailId, store.state.requests]);

  if (!specimen) return null;

  const missing = missingProfileFields(specimen);
  const frozen = isSpecimenFrozen(store.state, specimen.id);
  const phase = migrationPhaseOf(store.state, specimen.id);
  const cabinet = specimen.cabinetId ? store.cabinetMap.get(specimen.cabinetId) : undefined;
  const discrepancies = store.state.discrepancies.filter((d) => d.specimenId === specimen.id);

  return (
    <div className="view-stack">
      <section className="panel detail-panel">
        <div className="heading">
          <div>
            <p>
              <button className="link-btn" onClick={closeDetail}>
                ← 返回列表
              </button>
            </p>
            <h2>
              {specimen.collectNo} <span className="species-inline">{specimen.species}</span>
            </h2>
          </div>
          <div className="spec-badges">
            <Badge tone={pressTone(specimen.press)}>{specimen.press}</Badge>
            <Badge tone={identifyTone(specimen.identify)}>{specimen.identify}</Badge>
            <Badge tone={loanTone(specimen.loan)}>{specimen.loan}</Badge>
            <Badge tone={specimen.stage === "stored" ? "green" : "gray"}>
              {specimen.stage === "stored" ? "已入库" : "入库队列"}
            </Badge>
            {!specimen.hasPhoto && <Badge tone="amber">需补照</Badge>}
            {frozen && <Badge tone="amber">迁移中·已冻结鉴定/借阅</Badge>}
            {phase !== "none" && (
              <Badge tone={migrationTone(phase === "reserved" ? "reserved" : phase === "migrated" ? "migrated" : phase === "cancelled" ? "cancelled" : "returned")}>
                {MIGRATION_LABEL[phase === "reserved" ? "reserved" : phase === "migrated" ? "migrated" : phase === "cancelled" ? "cancelled" : "returned"]}
              </Badge>
            )}
          </div>
        </div>

        <div className="detail-grid">
          <article>
            <h3>资料完整性</h3>
            <dl>
              <dt>采集号</dt>
              <dd>{specimen.collectNo || "—"}</dd>
              <dt>物种名称</dt>
              <dd>{specimen.species || "—"}</dd>
              <dt>采集人</dt>
              <dd>{specimen.collector || "—"}</dd>
              <dt>采集地点</dt>
              <dd>{specimen.loc.place || "—"}</dd>
              <dt>海拔</dt>
              <dd>{specimen.loc.altitude || "—"}</dd>
              <dt>生境描述</dt>
              <dd>{specimen.loc.habitat || "—"}</dd>
            </dl>
            {missing.length > 0 ? (
              <p className="hint-bad">资料不完整：缺少 {missing.join("、")}，不允许申请迁柜。</p>
            ) : specimen.press === "已压制" && specimen.stage === "stored" ? (
              <p className="hint-ok">资料完整且已入库，可申请柜位迁移。</p>
            ) : (
              <p className="hint-bad">
                {specimen.press !== "已压制" ? "尚未压制完成" : "尚未入库上柜"}，不允许申请迁柜。
              </p>
            )}
          </article>

          <article>
            <h3>柜位与馆藏</h3>
            <dl>
              <dt>当前柜位</dt>
              <dd>
                {cabinet ? `${cabinet.id}（${cabinet.zone}）` : specimen.stage === "queue" ? "未上柜" : "—"}
              </dd>
              <dt>上柜时间</dt>
              <dd>{formatDate(specimen.storedAt)}</dd>
              <dt>拍照</dt>
              <dd>{specimen.hasPhoto ? "已拍照" : "需补照"}</dd>
              <dt>建条时间</dt>
              <dd>{formatDate(specimen.createdAt)}</dd>
            </dl>
            <button onClick={() => store.togglePhoto(specimen.id)}>
              {specimen.hasPhoto ? "标记为需补照" : "补照完成"}
            </button>
          </article>
        </div>

        <div className="actions-panel">
          <div>
            <h3>鉴定</h3>
            <div className="chips">
              {IDENTIFY_STATUSES.map((s) => (
                <button
                  key={s}
                  className={specimen.identify === s ? "chip-on" : ""}
                  disabled={frozen}
                  title={frozen ? "迁移中冻结鉴定" : undefined}
                  onClick={() => {
                    const result = store.setIdentify(specimen.id, s);
                    if (!result.ok && result.error) store.pushToast("error", result.error);
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h3>借阅</h3>
            <button
              disabled={frozen || specimen.stage !== "stored"}
              title={frozen ? "迁移中冻结借阅" : specimen.stage !== "stored" ? "未入库标本不可借阅" : undefined}
              onClick={() => {
                const result = store.toggleLoan(specimen.id);
                if (!result.ok && result.error) store.pushToast("error", result.error);
              }}
            >
              {specimen.loan === "在馆" ? "借出登记" : "归还登记"}
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>迁移履历</p>
            <h2>柜位迁移与差异记录</h2>
          </div>
          <button
            onClick={() => {
              closeDetail();
              store.setTab("ledger");
            }}
          >
            前往迁柜台账
          </button>
        </div>
        {requests.length === 0 && <p className="empty">无迁移记录（旧记录按未迁移处理）。</p>}
        <div className="ledger-list">
          {requests.map((req) => {
            const disc = discrepancies.filter((d) => d.requestId === req.id);
            return (
              <article key={req.id} className="ledger-row">
                <div className="ledger-main">
                  <div className="ledger-path">
                    <span>{req.fromCabinetId}</span>
                    <i>→</i>
                    <span>{req.toCabinetId}</span>
                    <Badge tone="blue">{req.zone}</Badge>
                  </div>
                  <Badge tone={migrationTone(req.status)}>{MIGRATION_LABEL[req.status]}</Badge>
                </div>
                <div className="ledger-meta">
                  <span className="muted">申请 {formatDate(req.createdAt)}</span>
                  {req.acceptedAt && <span className="muted">接收 {formatDate(req.acceptedAt)}</span>}
                  {req.cancelledAt && <span className="muted">取消 {formatDate(req.cancelledAt)}</span>}
                  <span className="muted">{req.note}</span>
                </div>
                {disc.map((d) => (
                  <div key={d.id} className={`discrepancy-box ${d.resolved ? "resolved" : ""}`}>
                    <strong>差异复核</strong>
                    {d.types.map((t) => (
                      <Badge key={t} tone="red">
                        {DISCREPANCY_LABEL[t]}
                      </Badge>
                    ))}
                    {d.resolved && <Badge tone="green">已结案</Badge>}
                    <p>{d.detail}</p>
                    {d.resolved && <p className="muted">结案说明：{d.resolutionNote}</p>}
                  </div>
                ))}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
