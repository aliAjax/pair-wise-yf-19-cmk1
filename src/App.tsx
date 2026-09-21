import { useHerbarium } from "./herbarium/viewState";
import Workbench from "./herbarium/Workbench";
import Cabinets from "./herbarium/Cabinets";
import Ledger from "./herbarium/Ledger";
import Detail from "./herbarium/Detail";

function App() {
  const store = useHerbarium();
  const detailOpen = store.detailId !== null;

  return (
    <main className="app">
      <section className="hero compact">
        <p>hxyfront-62007 · 植物标本馆 · 本地持久化</p>
        <h1>植物标本馆入库与柜位管理</h1>
        <span>
          入库队列、鉴定筛选、采集地点信息卡、馆藏柜位记录与柜位迁移台账。迁柜仅对已入库且资料完整的标本开放，
          温湿度档一致且有余额方可申请，迁移中冻结鉴定与借阅，接收差异生成复核，全部数据本地同步、刷新保留。
        </span>
      </section>

      <nav className="tabs">
        <button className={store.tab === "workbench" ? "tab-on" : ""} onClick={() => store.setTab("workbench")}>
          入库工作台
        </button>
        <button className={store.tab === "cabinets" ? "tab-on" : ""} onClick={() => store.setTab("cabinets")}>
          馆藏柜位记录
        </button>
        <button className={store.tab === "ledger" ? "tab-on" : ""} onClick={() => store.setTab("ledger")}>
          柜位迁移台账
          {store.state.discrepancies.some((d) => !d.resolved) && <i className="dot" />}
        </button>
        <button className="reset-btn" onClick={store.resetLocal} title="清除本地数据并恢复示例">
          重置本地数据
        </button>
      </nav>

      {detailOpen ? (
        <Detail store={store} />
      ) : (
        <>
          {store.tab === "workbench" && <Workbench store={store} />}
          {store.tab === "cabinets" && <Cabinets store={store} />}
          {store.tab === "ledger" && <Ledger store={store} />}
        </>
      )}

      <div className="toasts">
        {store.toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </main>
  );
}

export default App;
