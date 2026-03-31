import ProfileClient from './ProfileClient';

export default function ProfilePage() {
  return (
    <section className="page profile-page" data-testid="page-profile">
      <div className="container">
        <div className="profile-page-intro">
          <span className="badge">Live data</span>
          <h2>Account profile</h2>
          <p>
            This page loads from <code>/api/demo-profile</code>. In demo recordings, Playwright serves a
            fixture response so you can change names and copy without touching the app source.
          </p>
        </div>
        <ProfileClient />
      </div>
    </section>
  );
}
