const FEATURES = [
  {
    icon: '⚡',
    title: 'Workflow Automation',
    desc: 'Build and deploy automation pipelines with a drag-and-drop editor. No code required.',
  },
  {
    icon: '📊',
    title: 'Real-time Analytics',
    desc: 'Live dashboards powered by streaming data. Slice by any dimension in seconds.',
  },
  {
    icon: '🤝',
    title: 'Team Collaboration',
    desc: 'Inline comments, shared workspaces, and granular permissions keep everyone in sync.',
  },
  {
    icon: '🔌',
    title: '200+ Integrations',
    desc: 'Connect Slack, GitHub, Salesforce, and more. REST & webhook APIs for everything else.',
  },
  {
    icon: '🔒',
    title: 'Enterprise Security',
    desc: 'SOC 2 Type II certified, SSO/SAML, end-to-end encryption, and audit logs.',
  },
  {
    icon: '💬',
    title: '24/7 Support',
    desc: 'Dedicated success managers for Enterprise. Average first response under 4 minutes.',
  },
];

export default function FeaturesPage() {
  return (
    <section className="page features-page" data-testid="page-features">
      <div className="section-header">
        <span className="badge">Features</span>
        <h2>Everything your team needs</h2>
        <p>One platform. Infinite possibilities. Built for speed and scale.</p>
      </div>
      <div className="features-grid">
        {FEATURES.map((f) => (
          <div className="feature-card" key={f.title}>
            <div className="feature-icon">{f.icon}</div>
            <h3>{f.title}</h3>
            <p>{f.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
