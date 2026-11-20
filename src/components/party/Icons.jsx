// Small icons shared by the big screen's HUD, briefing and dialogue panel.
// Item icons are renders of the game's own 3D models (public/ui/icons).

/* eslint-disable @next/next/no-img-element */

const ITEM = {
  coin: "/ui/icons/coin.webp",
  key: "/ui/icons/key.webp",
  oil: "/ui/icons/oil.webp",
  compass: "/ui/icons/compass.webp",
  chest: "/ui/icons/chest.webp",
};

export function ItemIcon({ name, size = 28, className, dim = false }) {
  if (name === "wisp") {
    return (
      <span className={className} style={{ width: size, height: size, display: "inline-grid", placeItems: "center" }} aria-hidden="true">
        <svg viewBox="0 0 24 24" width={size} height={size}>
          <defs>
            <radialGradient id="wisp-g">
              <stop offset="0" stopColor="#f4ffd0" />
              <stop offset="0.35" stopColor="#c8ff7a" stopOpacity="0.8" />
              <stop offset="1" stopColor="#c8ff7a" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="8" cy="9" r="6" fill="url(#wisp-g)" />
          <circle cx="16" cy="15" r="5" fill="url(#wisp-g)" />
          <circle cx="17" cy="6" r="3.5" fill="url(#wisp-g)" />
        </svg>
      </span>
    );
  }
  if (name === "torch") {
    return (
      <span className={className} style={{ width: size, height: size, display: "inline-grid", placeItems: "center" }} aria-hidden="true">
        <svg viewBox="0 0 24 24" width={size} height={size}>
          <path d="M3 17l6-3 2 3-6 3z" fill="#8a6a3a" />
          <path d="M11 12l10-6v12z" fill="#ffd772" opacity="0.55" />
          <circle cx="10.5" cy="14" r="2" fill="#fff4c4" />
        </svg>
      </span>
    );
  }
  if (name === "swift") {
    return (
      <span className={className} style={{ width: size, height: size, display: "inline-grid", placeItems: "center" }} aria-hidden="true">
        <svg viewBox="0 0 24 24" width={size} height={size}>
          <path d="M13 2L5 13h6l-2 9 9-12h-6z" fill="#9ff0a8" />
        </svg>
      </span>
    );
  }
  const src = ITEM[name];
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={className}
      style={{ objectFit: "contain", opacity: dim ? 0.28 : 1, filter: dim ? "grayscale(1)" : "drop-shadow(0 0 6px rgba(255, 211, 110, 0.45))" }}
      draggable={false}
    />
  );
}

export function Portrait({ src, color, size = 56, className }) {
  return (
    <span
      className={className}
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: "50%",
        overflow: "hidden",
        display: "inline-block",
        border: `2px solid ${color}`,
        background: `radial-gradient(circle at 50% 35%, color-mix(in srgb, ${color} 35%, #1a1626), #0b0b12)`,
        boxShadow: `0 0 18px color-mix(in srgb, ${color} 40%, transparent)`,
      }}
      aria-hidden="true"
    >
      <img src={src} alt="" width={size} height={size} style={{ width: "100%", height: "100%", objectFit: "cover" }} draggable={false} />
    </span>
  );
}
