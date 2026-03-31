/**
 * Demo profile fixture for AppFlow video capture tests.
 *
 * The app default lives in `app/src/lib/demoProfile.ts` (DEFAULT_DEMO_PROFILE).
 * Playwright routes `GET /api/demo-profile` to return `CAPTURE_DEMO_PROFILE`, so
 * recordings show deterministic copy — edit this object to change the tour
 * without changing what you see when browsing the app locally.
 */

export type DemoProfile = {
  id: string;
  displayName: string;
  role: string;
  email: string;
  bio: string;
  skills: string[];
  memberSince: string;
  avatarHue: number;
};

export const CAPTURE_DEMO_PROFILE: DemoProfile = {
  id: 'user-demo-capture',
  displayName: 'Jordan Lee',
  role: 'Engineering Lead',
  email: 'jordan.lee@example.com',
  bio:
    'Ships the demo workflow stack. This text comes from the Playwright fixture — swap values here to refresh the recorded tour.',
  skills: ['Playwright', 'Next.js', 'ffmpeg', 'Release automation'],
  memberSince: 'January 2025',
  avatarHue: 188,
};
