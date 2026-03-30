'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import type { DemoProfile } from '@/lib/demoProfile';

export default function ProfileClient() {
  const [profile, setProfile] = useState<DemoProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/demo-profile', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as DemoProfile;
        if (!cancelled) setProfile(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <p className="profile-error" data-testid="profile-error">
        {error}
      </p>
    );
  }

  if (!profile) {
    return (
      <div className="profile-skeleton" data-testid="profile-loading">
        <div className="profile-skeleton-avatar" />
        <div className="profile-skeleton-line w-40" />
        <div className="profile-skeleton-line w-full" />
        <div className="profile-skeleton-line w-90" />
      </div>
    );
  }

  const initial = profile.displayName.trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="profile-card" data-testid="profile-loaded">
      <div
        className="profile-avatar"
        style={{ '--avatar-hue': String(profile.avatarHue) } as CSSProperties}
        data-testid="profile-avatar"
        aria-hidden
      >
        {initial}
      </div>
      <div className="profile-header-text">
        <h2 data-testid="profile-name">{profile.displayName}</h2>
        <p className="profile-role" data-testid="profile-role">
          {profile.role}
        </p>
        <a className="profile-email" href={`mailto:${profile.email}`} data-testid="profile-email">
          {profile.email}
        </a>
      </div>
      <p className="profile-bio" data-testid="profile-bio">
        {profile.bio}
      </p>
      <div className="profile-meta">
        <span className="badge">Team member since</span>
        <span data-testid="profile-since">{profile.memberSince}</span>
      </div>
      <div className="profile-skills">
        <h3>Focus areas</h3>
        <ul data-testid="profile-skills">
          {profile.skills.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
