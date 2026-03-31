'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

function navLinkClass(pathname: string, href: string, end?: boolean): string {
  const active = end ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return active ? 'active' : '';
}

export default function NavBar() {
  const pathname = usePathname() ?? '';

  return (
    <nav className="nav">
      <Link href="/" className="nav-logo">
        <div className="nav-logo-icon" />
        AppFlow
      </Link>
      <ul className="nav-links">
        <li>
          <Link href="/" className={navLinkClass(pathname, '/', true)}>
            Home
          </Link>
        </li>
        <li>
          <Link href="/features" className={navLinkClass(pathname, '/features')}>
            Features
          </Link>
        </li>
        <li>
          <Link href="/dashboard" className={navLinkClass(pathname, '/dashboard')}>
            Dashboard
          </Link>
        </li>
        <li>
          <Link href="/profile" className={navLinkClass(pathname, '/profile')}>
            Profile
          </Link>
        </li>
      </ul>
      <Link href="/get-started" className="nav-cta">
        Get Started
      </Link>
    </nav>
  );
}
