import { Suspense, lazy, useEffect, useState } from 'react';
import { ArrowDown, ArrowRight, Building2, ShieldCheck, Sparkles, Wrench } from 'lucide-react';
import { Link } from 'react-router-dom';

const ArchitecturalScene = lazy(() => import('../components/ArchitecturalScene.jsx'));

const features = [
  {
    icon: Wrench,
    title: 'Care without the friction',
    description: 'From the first report to the final resolution, every repair has a clear place and a visible next step.',
  },
  {
    icon: Sparkles,
    title: 'Make room for life',
    description: 'Discover shared amenities and manage reservations from a single resident experience.',
  },
  {
    icon: ShieldCheck,
    title: 'A clearer point of view',
    description: 'Bring residents, property teams, and operations together around the details that matter.',
  },
];

export default function LandingPage() {
  const [enableScene, setEnableScene] = useState(false);

  useEffect(() => {
    const motionPreference = window.matchMedia(
      '(min-width: 761px) and (prefers-reduced-motion: no-preference)',
    );
    const updateScenePreference = () => setEnableScene(motionPreference.matches);
    updateScenePreference();
    motionPreference.addEventListener('change', updateScenePreference);
    return () => motionPreference.removeEventListener('change', updateScenePreference);
  }, []);

  return (
    <main className="public-site">
      <section className="landing-hero">
        <div className="landing-hero__image" />
        <Suspense fallback={null}>
          {enableScene && <ArchitecturalScene />}
        </Suspense>
        <header className="public-nav">
          <Link className="brand-lockup" to="/" aria-label="PropertyFlow home">
            <span className="brand-mark"><Building2 aria-hidden="true" /></span>
            <span><strong>PropertyFlow</strong><small>Residential operations</small></span>
          </Link>
          <nav aria-label="Main navigation">
            <a href="#experience">The experience</a>
            <Link className="public-nav__login" to="/login">Sign in</Link>
            <Link className="button-primary" to="/register">Get started <ArrowRight aria-hidden="true" /></Link>
          </nav>
        </header>
        <div className="landing-copy">
          <p className="eyebrow"><span /> The future of residential living</p>
          <h1>Smarter living.<br /><em>Seamless property care.</em></h1>
          <p className="landing-copy__description">
            A more connected way to care for the places people call home. Coordinate
            maintenance, shared amenities, and everyday operations in one thoughtful space.
          </p>
          <div className="landing-actions">
            <Link className="button-primary" to="/register">Create your account <ArrowRight aria-hidden="true" /></Link>
            <Link className="button-quiet" to="/login">Sign in to your workspace</Link>
          </div>
          <a className="scroll-cue" href="#experience"><ArrowDown aria-hidden="true" /> One connected experience</a>
        </div>
        <div className="landing-orbit" aria-hidden="true">
          <span className="landing-orbit__dot" />
          <span className="landing-orbit__label">Designed around home</span>
        </div>
      </section>

      <section className="experience-section" id="experience">
        <div className="section-heading">
          <p className="eyebrow">One connected experience</p>
          <h2>Every detail, beautifully in hand.</h2>
          <p>Purposeful tools for the places, people, and teams that make a residence feel like home.</p>
        </div>
        <div className="feature-grid">
          {features.map(({ icon: Icon, title, description }, index) => (
            <article className="feature-card" key={title} style={{ '--feature-index': index }}>
              <div className="feature-card__icon"><Icon aria-hidden="true" /></div>
              <h3>{title}</h3>
              <p>{description}</p>
              <span className="feature-card__index">0{index + 1}</span>
            </article>
          ))}
        </div>
        <div className="experience-image" role="img" aria-label="Contemporary residential architecture">
          <div>
            <p className="eyebrow">A home for every part of the experience</p>
            <h2>Beautifully considered.<br /><em>Thoughtfully managed.</em></h2>
          </div>
        </div>
      </section>
      <footer className="public-footer">
        <Link className="brand-lockup" to="/"><span className="brand-mark"><Building2 aria-hidden="true" /></span><span><strong>PropertyFlow</strong><small>Residential operations</small></span></Link>
        <p>Better care for the places we call home.</p>
        <Link to="/login">Sign in <ArrowRight aria-hidden="true" /></Link>
      </footer>
    </main>
  );
}
