import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

export default function GetStarted() {
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitted(true);
  }

  return (
    <section className="page get-started-page" data-testid="page-get-started">
      <div className="signup-card">
        <h2>Create your account</h2>
        <p>Join 50,000+ teams already using AppFlow — free forever on the Starter plan.</p>

        {submitted && (
          <div className="success-banner" data-testid="success-banner">
            ✓ Welcome aboard! Check your inbox for a confirmation email.
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="name">Full name</label>
            <input
              id="name"
              name="name"
              type="text"
              placeholder="Jane Smith"
              required
              autoComplete="name"
              data-testid="input-name"
            />
          </div>
          <div className="form-group">
            <label htmlFor="email">Work email</label>
            <input
              id="email"
              name="email"
              type="email"
              placeholder="jane@company.com"
              required
              autoComplete="email"
              data-testid="input-email"
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              placeholder="Min. 8 characters"
              required
              autoComplete="new-password"
              data-testid="input-password"
            />
          </div>
          <button type="submit" className="btn btn-primary signup-submit" data-testid="btn-submit">
            Create free account →
          </button>
        </form>
        <p className="form-footer">
          Already have an account?{' '}
          <Link to="/">Sign in</Link>
        </p>
      </div>
    </section>
  );
}
