// 馆藏柜位记录：温湿度档、容量、余额、在柜标本、迁移预留、来源保留
import type { HerbariumStore } from "./viewState";
import type { MigrationRequest, Specimen } from "./model";
import { Badge, MIGRATION_LABEL, formatDate } from "./ui";
import { cabinetBalance, cabinetOccupancy, cabinetReserved } from "./migrationRules";

function RequestChip({
  store,
  req,
  specimen,
}: {
  store: HerbariumStore;
  req: MigrationRequest;
  specimen?: Specimen;
}) {
  return (
    <span className="mini-chip" title={`申请 ${formatDate(req.createdAt)}`}>
      {MIGRATION_LABEL[req.status]}：{specimen?.collectNo ?? req.specimenId}
    </span>
  );
}

export default function Cabinets({ store }: { store: HerbariumStore }) {
  const { state, openDetail } = store;

  return (
    <div className="view-stack">
      <section className="panel">
        <div className="heading">
          <div>
            <p>馆藏柜位记录</p>
            <h2>柜位温湿度档与占用余额</h2>
          </div>
          <span className="hint">
            余额 = 容量 − 在柜数 − 迁移预留；迁移中来源柜继续保留，标本仍占来源名额
          </span>
        </div>
        <div className="cabinet-grid">
          {state.cabinets.map((cabinet) => {
            const occupied = cabinetOccupancy(state, cabinet.id);
            const reserved = cabinetReserved(state, cabinet.id);
            const balance = cabinetBalance(state, cabinet.id);
            const inside = state.specimens.filter(
              (s) => s.stage === "stored" && s.cabinetId === cabinet.id,
            );
            const reservations = state.requests.filter(
              (r) => r.status === "reserved" && r.toCabinetId === cabinet.id,
            );
            const keptSources = state.requests.filter(
              (r) => r.status === "reserved" && r.fromCabinetId === cabinet.id,
            );

            return (
              <article key={cabinet.id} className="cabinet-card">
                <div className="cabinet-head">
                  <h3>{cabinet.id}</h3>
                  <Badge tone="blue">{cabinet.zone}</Badge>
                </div>
                <div className="cabinet-num">
                  <div>
                    <small>在柜</small>
                    <strong>{occupied}</strong>
                  </div>
                  <div>
                    <small>预留</small>
                    <strong className={reserved > 0 ? "num-amber" : ""}>{reserved}</strong>
                  </div>
                  <div>
                    <small>容量</small>
                    <strong>{cabinet.capacity}</strong>
                  </div>
                  <div>
                    <small>余额</small>
                    <strong className={balance > 0 ? "num-green" : "num-red"}>{balance}</strong>
                  </div>
                </div>
                <div className="bar">
                  <i className="bar-occupied" style={{ width: `${(occupied / cabinet.capacity) * 100}%` }} />
                  <i className="bar-reserved" style={{ width: `${(reserved / cabinet.capacity) * 100}%` }} />
                </div>
                <ul className="cabinet-list">
                  {inside.map((s) => (
                    <li key={s.id}>
                      <button className="link-btn" onClick={() => openDetail(s.id)}>
                        {s.collectNo}
                      </button>
                      <span className="muted">{s.species}</span>
                      {store.frozenIds.has(s.id) && <Badge tone="amber">来源保留·冻结</Badge>}
                    </li>
                  ))}
                  {inside.length === 0 && <li className="muted">空柜</li>}
                </ul>
                {keptSources.length > 0 && (
                  <div className="cabinet-extra">
                    <p className="muted">迁出中（来源保留）：</p>
                    {keptSources.map((r) => (
                      <RequestChip key={r.id} store={store} req={r} specimen={store.specimenMap.get(r.specimenId)} />
                    ))}
                  </div>
                )}
                {reservations.length > 0 && (
                  <div className="cabinet-extra">
                    <p className="muted">目标预留：</p>
                    {reservations.map((r) => (
                      <RequestChip key={r.id} store={store} req={r} specimen={store.specimenMap.get(r.specimenId)} />
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
