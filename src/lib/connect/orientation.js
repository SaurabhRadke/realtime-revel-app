// DeviceOrientation -> quaternion.
//
// The browser reports the phone's attitude as Tait-Bryan angles (degrees):
//   alpha about Z (up), then beta about the new X, then gamma about the new Y
// i.e. R = Rz(alpha) * Rx(beta) * Ry(gamma), mapping device axes (x right,
// y towards the top edge, z out of the screen) into the earth frame
// (x east, y north, z up).
//
// We send that as a quaternion rather than the three angles: angles have
// gimbal lock and wrap-around (alpha jumps 359 -> 0), so they can't be
// interpolated. The desktop slerps quaternions for smooth aiming.

const D2R = Math.PI / 180;

function mul(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function orientationToQuaternion(alpha, beta, gamma) {
  const a = (alpha * D2R) / 2;
  const b = (beta * D2R) / 2;
  const g = (gamma * D2R) / 2;
  const qz = [0, 0, Math.sin(a), Math.cos(a)];
  const qx = [Math.sin(b), 0, 0, Math.cos(b)];
  const qy = [0, Math.sin(g), 0, Math.cos(g)];
  return mul(mul(qz, qx), qy);
}

/** Direction of the phone's top edge: { heading (rad, clockwise from north), elevation (rad) }. */
export function topEdgeAim([x, y, z, w]) {
  // Rotate (0, 1, 0) by q: second column of the rotation matrix.
  const dx = 2 * (x * y - w * z);
  const dy = 1 - 2 * (x * x + z * z);
  const dz = 2 * (y * z + w * x);
  return { heading: Math.atan2(dx, dy), elevation: Math.asin(Math.max(-1, Math.min(1, dz))) };
}

/** iOS 13+ gates motion sensors behind a permission prompt that needs a tap. */
export async function requestOrientationPermission() {
  const DOE = typeof window !== "undefined" ? window.DeviceOrientationEvent : undefined;
  if (!DOE) return "unsupported";
  if (typeof DOE.requestPermission === "function") {
    try {
      return await DOE.requestPermission(); // "granted" | "denied"
    } catch {
      return "denied";
    }
  }
  return "granted";
}
