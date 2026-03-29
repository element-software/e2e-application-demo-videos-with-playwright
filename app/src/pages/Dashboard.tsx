/** Maximum pixel height for bars (leaves room for month labels below) */
const BAR_MAX_PX = 128;

const METRICS = [
  { label: 'Monthly Active Users', value: '124,830', delta: '+12.4%', up: true },
  { label: 'Workflows Triggered', value: '3.2 M', delta: '+8.1%', up: true },
  { label: 'Avg. Response Time', value: '142 ms', delta: '-6.3%', up: true },
  { label: 'Error Rate', value: '0.04%', delta: '-0.01%', up: true },
];

const BAR_DATA = [
  { month: 'Oct', pct: 55 },
  { month: 'Nov', pct: 63 },
  { month: 'Dec', pct: 71 },
  { month: 'Jan', pct: 68 },
  { month: 'Feb', pct: 80 },
  { month: 'Mar', pct: 92 },
];

const BAR_MAX_PCT = Math.max(...BAR_DATA.map((d) => d.pct));

export default function Dashboard() {
  return (
    <section className="page dashboard-page" data-testid="page-dashboard">
      <div className="container">
        <div className="dashboard-header">
          <div>
            <h2>Dashboard</h2>
            <p>Last updated: just now — all times UTC</p>
          </div>
          <button className="btn btn-outline" style={{ fontSize: '.85rem', padding: '.5rem 1rem' }}>
            Export CSV
          </button>
        </div>

        <div className="metrics-grid">
          {METRICS.map((m) => (
            <div className="metric-card" key={m.label}>
              <div className="metric-label">{m.label}</div>
              <div className="metric-value">{m.value}</div>
              <div className={`metric-delta ${m.up ? 'up' : 'down'}`}>
                {m.up ? '▲' : '▼'} {m.delta} vs last period
              </div>
            </div>
          ))}
        </div>

        <div className="chart-section">
          <div className="chart-title">Monthly Active Users — last 6 months</div>
          <div className="bar-chart" role="img" aria-label="Bar chart of monthly active users">
            {BAR_DATA.map((d) => (
              <div className="bar-wrap" key={d.month}>
              <div className="bar" style={{ height: Math.round((d.pct / BAR_MAX_PCT) * BAR_MAX_PX) }} title={`${d.month}: ${d.pct}%`} />
                <span className="bar-label">{d.month}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
