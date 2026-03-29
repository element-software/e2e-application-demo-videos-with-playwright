import { NavLink } from 'react-router-dom';

export default function NavBar() {
  return (
    <nav className="nav">
      <div className="nav-logo">
        <div className="nav-logo-icon" />
        AppFlow
      </div>
      <ul className="nav-links">
        <li><NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}>Home</NavLink></li>
        <li><NavLink to="/features" className={({ isActive }) => isActive ? 'active' : ''}>Features</NavLink></li>
        <li><NavLink to="/dashboard" className={({ isActive }) => isActive ? 'active' : ''}>Dashboard</NavLink></li>
      </ul>
      <NavLink to="/get-started" className="nav-cta">Get Started</NavLink>
    </nav>
  );
}
