// Deterministic heightfield character physics shared by the Rust ABI v4
// step and this JS fallback. The state/input/output contract is a single
// Float64Array(32), preallocated by the caller, so stepping physics does
// not allocate vectors, objects, or closures in the frame loop.
//
// The equations are an original meter-scale synthesis of the classic
// Quake-style PM_Friction / PM_Accelerate / PM_AirAccelerate structure
// (projection-capped acceleration, control-speed friction) with the
// heightfield step-up, steep-slope slide and contour-slide handling used
// by lightweight BVH/capsule controllers. No third-party code is copied.

export const PHYS = {
  PX: 0, PY: 1, PZ: 2,          // feet position (state in/out)
  VX: 3, VY: 4, VZ: 5,          // velocity (state in/out)
  GROUNDED: 6, COYOTE: 7,       // state in/out
  DT: 8, WISH_X: 9, WISH_Z: 10, // input: wish vector, length <= 1
  WISH_SPEED: 11, JUMP: 12,
  GROUND_ACCEL: 13, AIR_ACCEL: 14, FRICTION: 15, STOP_SPEED: 16,
  AIR_WISH_CAP: 17, GRAVITY: 18, JUMP_SPEED: 19, STEP_HEIGHT: 20,
  SNAP_DISTANCE: 21, WALK_NORMAL_Y: 22, SLOPE_GRAVITY_SCALE: 23,
  GROUND_Y: 24, NORMAL_X: 25, NORMAL_Y: 26, NORMAL_Z: 27, // outputs
  LANDED_IMPACT: 28, SLIDING: 29, BLOCKED: 30, HSPEED: 31,
};

const SAMPLE_EPS = 0.6;
const _sample = new Float64Array(4); // height, normal x/y/z scratch

function sampleGround(ground, x, z) {
  const h = ground(x, z);
  const gx = (ground(x + SAMPLE_EPS, z) - ground(x - SAMPLE_EPS, z)) / (SAMPLE_EPS * 2);
  const gz = (ground(x, z + SAMPLE_EPS) - ground(x, z - SAMPLE_EPS)) / (SAMPLE_EPS * 2);
  const inv = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
  _sample[0] = h;
  _sample[1] = -gx * inv;
  _sample[2] = inv;
  _sample[3] = -gz * inv;
  return _sample;
}

export function stepPhysicsBuffer(b, ground) {
  let px = b[0], py = b[1], pz = b[2];
  let vx = b[3], vy = b[4], vz = b[5];
  const wasGrounded = b[6] > 0.5;
  let coyote = b[7];
  const dt = b[8];
  const wishX = b[9], wishZ = b[10], wishSpeed = b[11];
  const jump = b[12] > 0.5;
  const groundAccel = b[13], airAccel = b[14], friction = b[15];
  const stopSpeed = b[16], airWishCap = b[17], gravity = b[18];
  const jumpSpeed = b[19], stepHeight = b[20], snapDistance = b[21];
  const walkNormalY = b[22], slopeGravityScale = b[23];

  const startX = px, startY = py, startZ = pz;
  let s = sampleGround(ground, px, pz);
  const startGroundY = s[0], snx = s[1], sny = s[2], snz = s[3];

  let grounded = wasGrounded;
  let sliding = grounded && sny < walkNormalY && py <= startGroundY + 0.65;

  // Ground friction: a speed-proportional drop with a control-speed
  // floor, so the last part of a stop does not crawl asymptotically.
  if (grounded && !sliding) {
    const speed = Math.hypot(vx, vz);
    if (speed > 0.0001) {
      const control = Math.max(speed, stopSpeed);
      const next = Math.max(0, speed - control * friction * dt);
      const scale = next / speed;
      vx *= scale; vz *= scale;
    }
  }

  let jumped = false;
  if (jump && !sliding && (grounded || coyote > 0)) {
    vy = jumpSpeed;
    grounded = false;
    coyote = 0;
    jumped = true;
  }

  // Projection-capped acceleration. On the ground this adds speed only
  // along the wish direction up to wishSpeed; in the air the *target*
  // along the wish direction is capped much lower, which gives weak
  // corrective control without strafe-jump speed farming.
  if (!sliding) {
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 0.000001 && wishSpeed > 0) {
      const dirScale = 1 / wishLen;
      const dirX = wishX * dirScale, dirZ = wishZ * dirScale;
      const effectiveSpeed = wishSpeed * Math.min(1, wishLen);
      const current = vx * dirX + vz * dirZ;
      const target = grounded ? effectiveSpeed : Math.min(effectiveSpeed, airWishCap);
      const add = target - current;
      if (add > 0) {
        const accel = grounded ? groundAccel : airAccel;
        const delta = Math.min(accel * effectiveSpeed * dt, add);
        vx += dirX * delta;
        vz += dirZ * delta;
      }
    }
  }

  // Gravity projected onto walkable ground creates uphill resistance and
  // downhill gain. On an unwalkable slope it becomes a full slide.
  if (wasGrounded && !jumped) {
    const scale = sliding ? 1 : slopeGravityScale;
    const ax = -gravity * sny * snx * scale;
    const az = -gravity * sny * snz * scale;
    vx += ax * dt;
    vz += az * dt;
  }

  if (grounded) {
    if (vy < 0) vy = 0;
  } else {
    vy = Math.max(vy + gravity * dt, -38);
  }

  let nextX = px + vx * dt;
  let nextZ = pz + vz * dt;
  let nextY = py + vy * dt;
  s = sampleGround(ground, nextX, nextZ);
  let groundY = s[0], nnx = s[1], nny = s[2], nnz = s[3];

  let nowGrounded = false;
  let landedImpact = 0;
  let blocked = 0;
  let resolved = false;

  if (nextY <= groundY) {
    const rise = groundY - startY;
    const walkingWall = wasGrounded && rise > stepHeight && vy <= 0.5;
    const airWall = !wasGrounded && rise > stepHeight && vy > -6;
    if (walkingWall || airWall) {
      blocked = 1;
      // First try the part of this frame's displacement that follows the
      // terrain contour instead of driving straight into the rise.
      let ux = -nnx, uz = -nnz; // uphill direction
      const ul = Math.hypot(ux, uz);
      if (ul > 0.000001) {
        ux /= ul; uz /= ul;
        let dx = nextX - px, dz = nextZ - pz;
        const into = dx * ux + dz * uz;
        if (into > 0) { dx -= ux * into; dz -= uz * into; }
        const cx2 = px + dx, cz2 = pz + dz;
        s = sampleGround(ground, cx2, cz2);
        const g2 = s[0], n2x = s[1], n2y = s[2], n2z = s[3];
        if (!(nextY <= g2 && g2 - startY > stepHeight)) {
          nextX = cx2; nextZ = cz2;
          const vin = vx * ux + vz * uz;
          if (vin > 0) { vx -= ux * vin; vz -= uz * vin; }
          groundY = g2; nnx = n2x; nny = n2y; nnz = n2z;
        } else {
          nextX = px; nextZ = pz;
          const vin = vx * ux + vz * uz;
          if (vin > 0) { vx -= ux * vin; vz -= uz * vin; }
          s = sampleGround(ground, nextX, nextZ);
          groundY = s[0]; nnx = s[1]; nny = s[2]; nnz = s[3];
          if (wasGrounded && nextY <= groundY + snapDistance) {
            nextY = groundY;
            nowGrounded = true;
            vy = 0;
          } else if (nextY < groundY) {
            nextY = groundY;
          }
          resolved = true;
        }
      }
    }

    if (!resolved && nextY <= groundY) {
      if (vy <= 0) {
        landedImpact = wasGrounded ? 0 : -vy;
        nextY = groundY;
        nowGrounded = true;
        if (landedImpact > 8) {
          const damp = Math.min(1, Math.max(0.5, 1 - (landedImpact - 8) * 0.03));
          vx *= damp; vz *= damp;
        }
        vy = 0;
      } else if (groundY - startY <= stepHeight) {
        nextY = groundY; // pop over a small lip while rising
      } else {
        blocked = 1;
        nextX = px; nextZ = pz;
        s = sampleGround(ground, nextX, nextZ);
        groundY = s[0]; nnx = s[1]; nny = s[2]; nnz = s[3];
        if (nextY < groundY) nextY = groundY;
      }
    }
  }

  // Downhill ground snap keeps a grounded runner glued to descending
  // terrain instead of launching off every crest.
  if (!nowGrounded && wasGrounded && !jumped && vy <= 0
    && nextY <= groundY + snapDistance && nextY >= groundY - 0.02) {
    if (nextY < groundY) nextY = groundY;
    else nextY += (groundY - nextY) * Math.min(1, dt * 20);
    nowGrounded = true;
    vy = 0;
  }

  sliding = nowGrounded && nny < walkNormalY;
  coyote = nowGrounded ? 0.12 : (jumped ? 0 : Math.max(0, coyote - dt));

  b[0] = nextX; b[1] = nextY; b[2] = nextZ;
  b[3] = vx; b[4] = vy; b[5] = vz;
  b[6] = nowGrounded ? 1 : 0;
  b[7] = coyote;
  b[24] = groundY; b[25] = nnx; b[26] = nny; b[27] = nnz;
  b[28] = landedImpact;
  b[29] = sliding ? 1 : 0;
  b[30] = blocked;
  b[31] = Math.hypot(vx, vz);
  return b;
}
