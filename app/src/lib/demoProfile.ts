/**
 * Shape of the demo user profile returned by GET /api/demo-profile.
 * E2E captures can override this response via Playwright routing while the
 * API keeps a separate default for manual browsing.
 */
export type DemoProfile = {
  id: string;
  displayName: string;
  role: string;
  email: string;
  bio: string;
  skills: string[];
  memberSince: string;
  /** 0–360, used for avatar accent */
  avatarHue: number;
};

export const DEFAULT_DEMO_PROFILE: DemoProfile = {
  id: 'user-default',
  displayName: 'Alex Rivera',
  role: 'Product Designer',
  email: 'alex.rivera@example.com',
  bio:
    'Owns design systems and onboarding. This copy ships with the app so you can browse the profile without running tests.',
  skills: ['Figma', 'Design tokens', 'Prototyping', 'Accessibility'],
  memberSince: 'March 2024',
  avatarHue: 265,
};
