// 柜位迁移台账：批量申请（同类只留一条 / 整次拒绝）、接收核对、
// 取消、差异复核。记录同步刷新并持久化，旧记录按「未迁移」展示。
import { useEffect, useMemo, useState } from "react";
import type { HerbariumStore } from "./viewState";
import type { MigrationRequest } from "./model";
import {
  DISCREPANCY_LABEL,
  Badge,
  MIGRATION_LABEL,
  Modal,
  formatDate,
  migrationTone,
} from "./ui";
import {
  cabinetBalance,
  cabinetReserved,
  missingProfileFields,
} from "./migrationRules";

function RulesSummary() {
  return (
    <section className="panel rules-panel">
      <div className="heading">
        <div>
          <p>迁柜规则</p>
          <h2>柜位迁移台账规则</h2>
        </div>
      </div>
      <ol className="rules-list">
        <li>只有<b>已入库且资料完整</b>（已压制、采集/物种/采集人/地点/海拔/生境齐全）的标本能申请迁柜。</li>
        <li>目标柜位<b>温湿度档需一致</b>且<b>有余额</b>（余额含其他申请的预留）。</li>
        <li><b>同类申请只保留一条</b>：同一标本已有进行中申请或同批重复，<b>整次拒绝</b>，原柜位与队列不变。</li>
        <li>迁移中<b>冻结鉴定和借阅</b>；来源柜继续保留标本名额。</li>
        <li>接收时<b>柜位不符或目标已占用</b>：退回来源柜并生成差异复核，未结前不得再迁。</li>
        <li>取消<b>只释放目标预留</b>，标本与来源柜记录不变。</li>
        <li>柜位记录、详情页与本地数据同步；旧记录按<b>未迁移</b>处理，刷新后保留。</li>
      </ol>
    </section>
  );
}

function BatchApply({ store }: { store: HerbariumStore }) {
  const { state, applyLines, setApplyLines, lineHints, applyErrors, submitApply, newApplyLine, ensureApplyLines } =
    store;
  useEffect(() => {
    ensureApplyLines();
  }, [ensureApplyLines]);

  const eligibleSpecimens = useMemo(
    () =>
      state.specimens.filter((s) => {
        if (s.stage !== "stored" || !s.cabinetId) return false;
        if (missingProfileFields(s).length > 0 || s.press !== "已压制") return false;
        if (store.frozenIds.has(s.id) || store.openDiscrepancyIds.has(s.id)) return false;
        return true;
      }),
    [state.specimens, store.frozenIds, store.openDiscrepancyIds],
  );

  const updateLine = (key: string, patch: Partial<{ specimenId: string; targetCabinetId: string }>) => {
    setApplyLines(applyLines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    store.setApplyErrors([]);
  };

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>批量申请</p>
          <h2>发起柜位迁移</h2>
        </div>
        <div className="heading-actions">
          <button onClick={() => setApplyLines([...applyLines, newApplyLine()])}>加一行</button>
          <button className="primary" onClick={() => submitApply(applyLines)}>
            提交整批申请
          </button>
        </div>
      </div>

      <div className="apply-lines">
        <div className="apply-row apply-head">
          <span>#</span>
          <span>标本（来源柜）</span>
          <span>目标柜位（温湿度档 · 余额）</span>
          <span>校验</span>
          <span></span>
        </div>
        {applyLines.map((line, index) => {
          const hint = lineHints[index];
          const specimen = state.specimens.find((s) => s.id === line.specimenId);
          const target = state.cabinets.find((c) => c.id === line.targetCabinetId);
          const rowError = applyErrors.find((e) => e.line === index + 1);
          return (
            <div key={line.key} className="apply-row">
              <b>{index + 1}</b>
              <select value={line.specimenId} onChange={(e) => updateLine(line.key, { specimenId: e.target.value })}>
                <option value="">选择标本…</option>
                {state.specimens
                  .filter((s) => s.stage === "stored")
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.collectNo}（{s.species} · {s.cabinetId}）
                      {eligibleSpecimens.some((e) => e.id === s.id) ? "" : " · 不符合资格"}
                    </option>
                  ))}
              </select>
              <select
                value={line.targetCabinetId}
                onChange={(e) => updateLine(line.key, { targetCabinetId: e.target.value })}
              >
                <option value="">选择目标柜位…</option>
                {state.cabinets.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id}（{c.zone} · 余 {cabinetBalance(state, c.id)}
                    {cabinetReserved(state, c.id) > 0 ? `，预留 ${cabinetReserved(state, c.id)}` : ""}）
                  </option>
                ))}
              </select>
              <span className={hint?.ok ? "hint-ok" : "hint-bad"}>
                {hint?.ok ? "✓ " : "✕ "}
                {hint?.message}
                {!hint?.ok && hint?.missingFields && hint.missingFields.length > 0
                  ? `（${hint.missingFields.join("、")}）`
                  : ""}
                {specimen && target && specimen.cabinetId === target.id ? "（目标即来源）" : ""}
              </span>
              <button
                className="icon-btn"
                disabled={applyLines.length <= 1}
                onClick={() => setApplyLines(applyLines.filter((l) => l.key !== line.key))}
              >
                ✕
              </button>
              {rowError && <p className="row-error">第 {rowError.line} 行：{rowError.message}</p>}
            </div>
          );
        })}
      </div>
      {applyErrors.length > 0 && (
        <div className="reject-box">
          <strong>整次拒绝</strong>
          <p>本批 {applyErrors.length} 处问题，全部申请均未落账，原柜位与队列不变：</p>
          <ul>
            {applyErrors.map((e) => (
              <li key={e.line}>
                第 {e.line} 行：{e.message}
                {e.missingFields && e.missingFields.length > 0 ? `（${e.missingFields.join("、")}）` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ReceiveDialog({ store }: { store: HerbariumStore }) {
  const { receiveDraft, setReceiveDraft, receive } = store;
  const [actualCabinetId, setActualCabinetId] = useState("");
  const [targetOccupied, setTargetOccupied] = useState(false);

  if (!receiveDraft) return null;
  const req = store.state.requests.find((r) => r.id === receiveDraft.requestId);
  if (!req || req.status !== "reserved") return null;
  const specimen = store.specimenMap.get(req.specimenId);

  const effectiveActual = actualCabinetId || req.toCabinetId;

  return (
    <Modal
      title={`接收核对 · ${specimen?.collectNo ?? req.specimenId}`}
      onClose={() => {
        setReceiveDraft(null);
        setActualCabinetId("");
        setTargetOccupied(false);
      }}
    >
      <div className="modal-body">
        <p className="muted">
          来源柜 {req.fromCabinetId} → 申请目标 {req.toCabinetId}（{req.zone}）
        </p>
        <label>
          <span>实物实际到达柜位</span>
          <select value={effectiveActual} onChange={(e) => setActualCabinetId(e.target.value)}>
            {store.state.cabinets.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id}（{c.zone}）
              </option>
            ))}
          </select>
        </label>
        <label className="checkline">
          <input
            type="checkbox"
            checked={targetOccupied}
            onChange={(e) => setTargetOccupied(e.target.checked)}
          />
          <span>目标柜位 {req.toCabinetId} 已被其他实物占用</span>
        </label>
        <p className="hint">
          实际柜位与目标不符，或目标已占用：标本退回来源柜 {req.fromCabinetId}
          ，释放目标预留并生成差异复核，未结前不得再迁。
        </p>
        <div className="modal-actions">
          <button
            onClick={() => {
              receive({ requestId: req.id, actualCabinetId: effectiveActual, targetOccupied });
              setActualCabinetId("");
              setTargetOccupied(false);
            }}
          >
            确认接收
          </button>
        </div>
      </div>
    </Modal>
  );
}

function LedgerRow({ store, req }: { store: HerbariumStore; req: MigrationRequest }) {
  const specimen = store.specimenMap.get(req.specimenId);
  const discrepancy = store.state.discrepancies.find((d) => d.requestId === req.id);
  return (
    <article className="ledger-row">
      <div className="ledger-main">
        <div className="ledger-id">
          <h3>{specimen?.collectNo ?? req.specimenId}</h3>
          <span className="muted">{specimen?.species}</span>
        </div>
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
      <div className="ledger-actions">
        {req.status === "reserved" && (
          <>
            <button
              className="primary"
              onClick={() =>
                store.setReceiveDraft({
                  requestId: req.id,
                  actualCabinetId: req.toCabinetId,
                  targetOccupied: false,
                })
              }
            >
              接收核对
            </button>
            <button onClick={() => store.cancel(req.id)}>取消（释放目标预留）</button>
          </>
        )}
        {specimen && <button onClick={() => store.openDetail(specimen.id)}>标本详情</button>}
      </div>
      {discrepancy && (
        <div className={`discrepancy-box ${discrepancy.resolved ? "resolved" : ""}`}>
          <div>
            <strong>差异复核</strong>
            {discrepancy.types.map((t) => (
              <Badge key={t} tone="red">
                {DISCREPANCY_LABEL[t]}
              </Badge>
            ))}
            {discrepancy.resolved && <Badge tone="green">已结案</Badge>}
            <p>{discrepancy.detail}</p>
            {discrepancy.resolved && discrepancy.resolvedAt && (
              <p className="muted">
                结案 {formatDate(discrepancy.resolvedAt)}：{discrepancy.resolutionNote}
              </p>
            )}
          </div>
          {!discrepancy.resolved && <ResolveBox store={store} discrepancyId={discrepancy.id} />}
        </div>
      )}
    </article>
  );
}

function ResolveBox({ store, discrepancyId }: { store: HerbariumStore; discrepancyId: string }) {
  const [note, setNote] = useState("");
  return (
    <div className="resolve-box">
      <input
        placeholder="复核结论（如：实物已归回来源柜，账实一致）"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button
        className="primary"
        onClick={() => {
          store.resolve(discrepancyId, note.trim());
          setNote("");
        }}
      >
        复核结案
      </button>
    </div>
  );
}

export default function Ledger({ store }: { store: HerbariumStore }) {
  const requests = useMemo(
    () => [...store.state.requests].sort((a, b) => b.createdAt - a.createdAt),
    [store.state.requests],
  );
  const openCount = store.state.discrepancies.filter((d) => !d.resolved).length;

  return (
    <div className="view-stack">
      <RulesSummary />
      <BatchApply store={store} />

      <section className="panel">
        <div className="heading">
          <div>
            <p>迁移台账</p>
            <h2>柜位迁移记录（{requests.length}）</h2>
          </div>
          {openCount > 0 && <Badge tone="red">{openCount} 条差异待复核</Badge>}
        </div>
        <div className="ledger-list">
          {requests.length === 0 && <p className="empty">暂无迁移记录，旧标本均按「未迁移」处理。</p>}
          {requests.map((req) => (
            <LedgerRow key={req.id} store={store} req={req} />
          ))}
        </div>
      </section>

      <ReceiveDialog key={store.receiveDraft?.requestId ?? "none"} store={store} />
    </div>
  );
}
