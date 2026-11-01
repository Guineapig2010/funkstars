export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  return (
    <div className={`logo logo-${size}`} aria-label="FUNKSTARS">
      <span className="logo-star" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M12 1.8l3.1 6.6 7.1.9-5.3 4.9 1.4 7.1L12 17.7l-6.3 3.6 1.4-7.1L1.8 9.3l7.1-.9z" /></svg>
      </span>
      <span className="logo-text" data-text="FUNKSTARS">FUNKSTARS</span>
    </div>
  );
}
