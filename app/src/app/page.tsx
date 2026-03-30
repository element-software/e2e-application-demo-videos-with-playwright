import Link from 'next/link';

export default function HomePage() {
  return (
    <section className="page hero" data-testid="page-home">
      <span className="badge">Now in public beta</span>
      <h1>
        Ship products faster<br />
        with <span>AppFlow</span>
      </h1>
      <p>
        The all-in-one platform for modern teams. Automate workflows,
        visualise metrics, and collaborate without friction.
      </p>
      <div className="hero-actions">
        <Link href="/get-started" className="btn btn-primary">
          Start for free →
        </Link>
        <Link href="/features" className="btn btn-outline">
          See features
        </Link>
      </div>
      <div className="hero-stats">
        <div className="hero-stat">
          <h3>50k+</h3>
          <p>Active teams</p>
        </div>
        <div className="hero-stat">
          <h3>99.9%</h3>
          <p>Uptime SLA</p>
        </div>
        <div className="hero-stat">
          <h3>4.9 ★</h3>
          <p>Average rating</p>
        </div>
      </div>
    </section>
  );
}
