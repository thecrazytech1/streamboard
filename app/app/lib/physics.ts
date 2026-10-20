/**
 * Gravity for board items.
 *
 * A simulation here is a long multi-item drag and nothing more: it reads the
 * items' geometry, runs matter.js over it, and hands back ItemTransforms. The
 * server never knows the difference between this and somebody dragging forty
 * emotes by hand, so none of its clamping, broadcasting or history needed
 * changing to support it.
 *
 * Everything is in world pixels, the space items already live in.
 */

import {
  Bodies,
  Body,
  Composite,
  Engine,
  type Body as MatterBody,
} from "matter-js";
import type { BoardItem, ItemTransform } from "@/types/board";
import { itemHeight, itemWidth, WORLD_HEIGHT, WORLD_WIDTH } from "./world";

/** Thickness of the walls. Thick enough that nothing tunnels out at speed. */
const WALL = 400;

/**
 * What the items are doing.
 *
 *   drop  — gravity pulls them to the floor of the stream frame, where they
 *           pile up and settle. Something that happens and is then over.
 *   float — no gravity at all: everything drifts and bounces off the edges of
 *           the frame, and keeps going until you stop it.
 */
export type GravityMode = "drop" | "float";

/**
 * How long a run may last before giving up on its own.
 *
 * Neither mode ends by itself any more: both stay live so that items added to
 * the frame join in without the whole thing being stopped and restarted. This
 * is only here so walking away doesn't leave a simulation running all night.
 */
export const MAX_RUN_MS = 10 * 60_000;

/**
 * How far an item's own position may drift from its body before the difference
 * is read as somebody moving it. Comfortably above rounding, well below a
 * deliberate drag.
 */
const EXTERNAL_EPSILON = 3;

/**
 * How long a body stays held after it was last moved from outside. Longer than
 * the gap between pointer moves, so a steady drag keeps it held; short enough
 * that letting go launches it immediately.
 */
const HOLD_MS = 140;

/**
 * How many of the simulation's own recent reports to match an item against.
 * Covers the lag between reporting a position and the item arriving at it,
 * which is a frame or two of React plus whatever the browser was busy with.
 */
const REPORT_HISTORY = 8;

/**
 * How long after a launch the simulation stops second-guessing an item.
 *
 * The drag's final position is committed *after* the last frame that saw it
 * move, so it's somewhere the simulation never reported — which looks exactly
 * like a fresh grab. Without this, every throw is recaptured a frame later and
 * relaunched from a single sample, which is to say at a standstill.
 */
const LAUNCH_GRACE_MS = 300;

/**
 * Matter expresses velocity as pixels per this, whatever the real frame rate —
 * Body.setVelocity scales by body.deltaTime / _baseDelta internally. Measuring
 * a throw in pixels per frame and handing it over unconverted makes every throw
 * wrong by the ratio between the display's refresh rate and 60Hz.
 */
const BASE_DELTA_MS = 1000 / 60;

/**
 * How much of the drag's tail decides the throw. One frame is far too noisy —
 * the last frame before release is often a slow one, and a single sample of
 * nearly-nothing turns a hard fling into a drop.
 */
const VELOCITY_WINDOW_MS = 110;

/**
 * Ceiling on launch speed, in world pixels per second. A hard fling can produce
 * an enormous delta on one frame, and a body moving further than its own width
 * in a step tunnels straight through a wall.
 *
 * Per second rather than per frame, so the limit means the same thing on a
 * 60Hz screen and a 144Hz one.
 */
const MAX_LAUNCH_PER_SECOND = 2600;

export type Simulation = {
  /** Advances the world by however long the last frame took. */
  step: (deltaMs: number) => void;
  /**
   * Takes in where the items actually are, and reconciles the bodies with it.
   *
   * "Moved on its own" means differing from what this simulation last reported,
   * not from where the body currently is. The two are never the same thing: the
   * sim's output reaches the items a frame or two later, through React, so a
   * body in flight is always ahead of the item. Comparing against the body
   * would read that lag as a drag and snatch everything back mid-throw.
   *
   * Anything that really has moved on its own — someone dragging it here, or an
   * editor dragging it somewhere else entirely — is pinned to that position and
   * held there while it keeps moving. When it stops, the body is let go carrying the
   * speed the drag gave it, which is what turns a throw into a throw.
   *
   * A held body is static, so it shoves the others around rather than being
   * shoved: dragging an emote through a floating crowd scatters them.
   */
  reconcile: (
    positions: ReadonlyMap<string, { x: number; y: number }>,
    now: number,
  ) => void;
  /**
   * Takes hold of items because a drag has started here, rather than waiting
   * for reconcile to infer it from movement.
   *
   * Inference is still how another editor's drags are picked up — there's no
   * signal from them but the movement itself. For a drag on this machine there
   * is one, and using it removes the guesswork: no threshold to cross before a
   * grab registers, and no timeout to wait out before a release launches.
   */
  grab: (ids: readonly string[], now: number) => void;
  /** Lets go, launching each item with the speed its drag gave it. */
  release: (ids: readonly string[], now: number) => void;
  /**
   * Brings the set of simulated bodies in line with the items that should be
   * simulated — which is everything currently inside the stream frame.
   *
   * This is what lets the board be edited while physics is running: drag an
   * emote into frame and it joins, drag one out and it stops being pushed
   * around, place a new one and it falls with the rest. Resize one and its
   * body is rescaled to match, instead of the old shape lingering invisibly.
   */
  sync: (items: readonly BoardItem[]) => void;
  /** Where everything is now, as transforms ready for the wire. */
  read: () => ItemTransform[];
  dispose: () => void;
};

/**
 * Drops a set of items inside the stream frame.
 *
 * The floor is the bottom of the frame rather than the bottom of the staging
 * area, so a pile lands on screen where people can see it — the whole point.
 */
export function simulate(
  items: readonly BoardItem[],
  mode: GravityMode = "drop",
): Simulation {
  const floating = mode === "float";

  const engine = Engine.create({
    // Sleeping answers "has it finished?" for a drop, and stops settled piles
    // jittering. Floating must never settle, so it's off there.
    enableSleeping: !floating,
  });
  engine.gravity.y = floating ? 0 : 1;

  const bodies = new Map<string, MatterBody>();

  /** The dimensions each body was built at, so a resize can be spotted. */
  const built = new Map<string, { width: number; height: number }>();

  const dimensionsOf = (item: BoardItem) => ({
    width: Math.max(1, itemWidth(item)),
    height: Math.max(1, itemHeight(item)),
  });

  /** Ids the simulation may collide with but must never move. */
  const pinnedIds = new Set<string>();

  /**
   * A body shaped like the item, for the shapes where that's honest.
   *
   * An ellipse with equal sides is a circle, and a circle collides like one —
   * things roll off it and glance away instead of catching on corners that
   * aren't drawn. Everything else is its box, which is what it has always been.
   */
  const shapedBody = (
    item: BoardItem,
    width: number,
    height: number,
    options: Record<string, unknown>,
  ) => {
    const x = item.x * WORLD_WIDTH;
    const y = item.y * WORLD_HEIGHT;
    const round =
      item.shape === "ellipse" && Math.abs(width - height) < Math.max(2, width * 0.05);

    return round
      ? Bodies.circle(x, y, width / 2, options)
      : Bodies.rectangle(x, y, width, height, options);
  };

  const addBody = (item: BoardItem) => {
    const { width, height } = dimensionsOf(item);
    if (item.pinned) pinnedIds.add(item.id);

    const body = shapedBody(
      item,
      width,
      height,
      item.pinned
        ? {
            // Part of the world, immovable in it: things land on a pinned
            // shape and pile against a pinned image, which is most of why
            // pinning is more useful than simply leaving the item out.
            angle: (item.rotation * Math.PI) / 180,
            isStatic: true,
            restitution: floating ? 1 : 0.4,
            friction: floating ? 0 : 0.35,
          }
        : floating
        ? {
            angle: (item.rotation * Math.PI) / 180,
            // Nothing may take energy out of the system, or the bouncing winds
            // down into a slow drift and then into nothing.
            restitution: 1,
            friction: 0,
            frictionAir: 0,
            frictionStatic: 0,
            // And nothing may convert it into spin, which is the same thing by
            // a quieter route. A square meeting a flat wall takes its impulse
            // at a corner, so it comes away turning — and a bounce measured
            // here kept only 45% of its speed because of it. Infinite inertia
            // means no rotation, so every bounce is as fast as the approach.
            //
            // Vertical motion suffered worst: the frame is 720 tall and 1280
            // wide, so things hit the top and bottom nearly twice as often and
            // died about twice as fast.
            inertia: Infinity,
          }
        : {
            angle: (item.rotation * Math.PI) / 180,
            restitution: 0.45,
            friction: 0.35,
            frictionAir: 0.008,
            // Matter's default. Lower than this and bodies freeze the instant
            // they're barely moving, so a pile lands and dies rather than
            // jostling into shape — which reads as the simulation breaking.
            sleepThreshold: 60,
          },
    );

    bodies.set(item.id, body);
    built.set(item.id, { width, height });
    Composite.add(engine.world, body);
    remember(item.id, body.position);
  };

  const removeBody = (id: string) => {
    const body = bodies.get(id);
    if (body) Composite.remove(engine.world, body);

    bodies.delete(id);
    built.delete(id);
    pinnedIds.delete(id);
    held.delete(id);
    launched.delete(id);
    reported.delete(id);
    sources.delete(id);
  };

  const halfW = WORLD_WIDTH / 2;
  const halfH = WORLD_HEIGHT / 2;
  const walls = [
    // Floor, then the two sides. A drop has no ceiling — something flung upward
    // should leave rather than bounce back down out of nowhere — but floating
    // is played inside a box, so it gets one.
    Bodies.rectangle(halfW, WORLD_HEIGHT + WALL / 2, WORLD_WIDTH * 3, WALL, {
      isStatic: true,
    }),
    ...(floating
      ? [
          Bodies.rectangle(halfW, -WALL / 2, WORLD_WIDTH * 3, WALL, {
            isStatic: true,
          }),
        ]
      : []),
    Bodies.rectangle(-WALL / 2, halfH, WALL, WORLD_HEIGHT * 3, {
      isStatic: true,
    }),
    Bodies.rectangle(WORLD_WIDTH + WALL / 2, halfH, WALL, WORLD_HEIGHT * 3, {
      isStatic: true,
    }),
  ];
  // Walls take the same bounce, or every contact quietly drains the system.
  if (floating) for (const wall of walls) wall.restitution = 1;
  Composite.add(engine.world, walls);

  /**
   * The item behind each body, refreshed on every sync so a transform carries
   * the fields physics doesn't own — size, proportions, flips. Stale entries
   * here are what made a resize snap back: the simulation kept reporting the
   * dimensions an item had when it joined.
   */
  const sources = new Map<string, BoardItem>();

  type Sample = { t: number; x: number; y: number };

  /**
   * Bodies being moved from outside, with where they've been recently. The
   * trail is what the throw is measured from when they're let go.
   *
   * `explicit` marks a hold that came from a real drag on this machine, which
   * ends only when that drag ends. An inferred hold — another editor moving
   * something — has no such signal, so it expires on its own when the movement
   * stops.
   */
  const held = new Map<
    string,
    { until: number; trail: Sample[]; explicit: boolean }
  >();

  /** Items just thrown, and until when their own motion is taken on trust. */
  const launched = new Map<string, number>();

  /**
   * The recent positions this simulation reported for each body — a short
   * history, not just the last one.
   *
   * The history is the whole point. What the sim reports reaches the items a
   * frame or two later, through React, so an item is always a little behind its
   * body. Comparing against only the newest report reads that lag as somebody
   * dragging: a body flying at 2600px/s has moved forty pixels by the time the
   * item catches up, which sails past any sane threshold, and the simulation
   * snatches back every throw it makes. Matching against anything it reported
   * recently tells lag apart from a hand.
   */
  const reported = new Map<string, Array<{ x: number; y: number }>>();

  const remember = (id: string, position: { x: number; y: number }) => {
    const history = reported.get(id) ?? [];
    history.push({ x: position.x, y: position.y });
    if (history.length > REPORT_HISTORY) history.shift();
    reported.set(id, history);
  };

  /** How far an item is from anything the sim recently said about it. */
  const distanceFromReports = (
    id: string,
    wanted: { x: number; y: number },
    fallback: { x: number; y: number },
  ) => {
    const history = reported.get(id);
    if (!history?.length) return Math.hypot(wanted.x - fallback.x, wanted.y - fallback.y);

    let nearest = Infinity;
    for (const seen of history) {
      nearest = Math.min(nearest, Math.hypot(wanted.x - seen.x, wanted.y - seen.y));
    }
    return nearest;
  };

  /**
   * The throw, measured across the tail of the drag rather than its last frame,
   * and converted into the units matter wants.
   *
   * Releasing while still moving throws hard; coming to a stop and then letting
   * go sets the item down, because by then the trail says it wasn't moving.
   */
  const launchFrom = (trail: readonly Sample[]) => {
    const last = trail[trail.length - 1];
    if (!last) return { x: 0, y: 0 };

    // The oldest sample still inside the window, so the measurement covers the
    // end of the drag rather than all of it.
    const first =
      trail.find((sample) => last.t - sample.t <= VELOCITY_WINDOW_MS) ?? last;

    const elapsed = last.t - first.t;
    if (elapsed <= 0) return { x: 0, y: 0 };

    const perMs = {
      x: (last.x - first.x) / elapsed,
      y: (last.y - first.y) / elapsed,
    };

    const speed = Math.hypot(perMs.x, perMs.y) * 1000;
    const scale =
      speed > MAX_LAUNCH_PER_SECOND ? MAX_LAUNCH_PER_SECOND / speed : 1;

    return {
      x: perMs.x * scale * BASE_DELTA_MS,
      y: perMs.y * scale * BASE_DELTA_MS,
    };
  };

  /**
   * Brings the body set in line with the items that should be simulated.
   *
   * Three things in one pass, because they're the same question asked of every
   * item: is it here, should it be, and is it still the shape it was?
   */
  const sync = (next: readonly BoardItem[]) => {
    const wanted = new Set(next.map((item) => item.id));

    for (const id of [...bodies.keys()]) {
      if (!wanted.has(id)) removeBody(id);
    }

    for (const item of next) {
      sources.set(item.id, item);

      const body = bodies.get(item.id);
      if (!body) {
        addBody(item);
        continue;
      }

      // Pinning changes what the body *is*, so it's rebuilt rather than
      // adjusted — matter stores a static body's mass as infinite and restores
      // originals on the way back, which is fiddlier than starting over.
      if (pinnedIds.has(item.id) !== item.pinned) {
        removeBody(item.id);
        addBody(item);
        continue;
      }

      // Resized: scale the body to match rather than rebuild it, so whatever
      // it was doing — mid-flight, mid-pile — carries on uninterrupted.
      const previous = built.get(item.id);
      const { width, height } = dimensionsOf(item);
      if (
        previous &&
        (Math.abs(previous.width - width) > 0.5 ||
          Math.abs(previous.height - height) > 0.5)
      ) {
        Body.scale(body, width / previous.width, height / previous.height);
        built.set(item.id, { width, height });
      }
    }
  };

  sync(items);

  return {
    sync,

    // Variable delta rather than a fixed step. A fixed step only lines up with
    // the display at 60Hz; on a 144Hz screen a frame is 7ms, so a 16.7ms step
    // fires on some frames and not others and the motion visibly stutters.
    // Clamped, because a long stall followed by one huge step tunnels bodies
    // through walls.
    step: (deltaMs: number) =>
      Engine.update(engine, Math.min(Math.max(deltaMs, 1), 33)),

    grab: (ids, now) => {
      for (const id of ids) {
        const body = bodies.get(id);
        if (!body || held.has(id) || pinnedIds.has(id)) continue;

        Body.setStatic(body, true);
        held.set(id, {
          until: Number.POSITIVE_INFINITY,
          trail: [{ t: now, x: body.position.x, y: body.position.y }],
          explicit: true,
        });
      }
    },

    release: (ids, now) => {
      for (const id of ids) {
        const body = bodies.get(id);
        const hold = held.get(id);
        if (!body || !hold || pinnedIds.has(id)) continue;

        const velocity = launchFrom(hold.trail);
        held.delete(id);
        Body.setStatic(body, false);
        Body.setVelocity(body, velocity);
        launched.set(id, now + LAUNCH_GRACE_MS);

        console.debug(
          "[gravity] launch",
          id.slice(0, 8),
          `${Math.round(
            Math.hypot(velocity.x, velocity.y) * (1000 / BASE_DELTA_MS),
          )}px/s`,
          `from ${hold.trail.length} samples`,
        );
      }
    },

    reconcile: (positions, now) => {
      for (const [id, body] of bodies) {
        const wanted = positions.get(id);
        if (!wanted) continue;

        // Pinned: the item is in charge, always. Dragging one by hand moves
        // the obstacle; physics never moves it back.
        if (pinnedIds.has(id)) {
          Body.setPosition(body, wanted);
          remember(id, wanted);
          continue;
        }

        // Just thrown: whatever the item says, this is the simulation's own
        // doing. Trusting it here is what lets a throw survive its first frame.
        const grace = launched.get(id);
        if (grace !== undefined) {
          if (now < grace) {
            remember(id, body.position);
            continue;
          }
          launched.delete(id);
        }

        // Against anything we recently reported, not the body — see above.
        const drift = distanceFromReports(id, wanted, body.position);
        const moved = drift > EXTERNAL_EPSILON;
        const hold = held.get(id);

        if (moved) {
          if (!hold) Body.setStatic(body, true);
          Body.setPosition(body, wanted);
          // Where it is *is* what we'd report, so the next frame measures from
          // here rather than seeing this move a second time.
          remember(id, wanted);

          const trail = hold?.trail ?? [];
          trail.push({ t: now, x: wanted.x, y: wanted.y });
          // Only the tail is ever read; anything older is weight.
          while (trail.length > 1 && now - trail[0].t > VELOCITY_WINDOW_MS * 2) {
            trail.shift();
          }

          // Keeping `explicit` is the point: rewriting it here is what used to
          // turn a real drag back into a guess, so pausing to aim for longer
          // than HOLD_MS launched the item with the button still down.
          held.set(id, {
            until: hold?.explicit ? Number.POSITIVE_INFINITY : now + HOLD_MS,
            trail,
            explicit: hold?.explicit ?? false,
          });
          continue;
        }

        // Stopped moving on its own: hand it back to physics with the speed it
        // had. An explicit hold never reaches this — its expiry is infinite, and
        // only release() ends it.
        if (hold && now >= hold.until) {
          held.delete(id);
          Body.setStatic(body, false);
          Body.setVelocity(body, launchFrom(hold.trail));
        }
      }
    },

    read: () =>
      [...bodies].flatMap(([id, body]) => {
        const item = sources.get(id);
        // A held body's position is whatever moved it, which everyone already
        // has — reporting it back would fight the drag. A pinned one is never
        // the simulation's to report at all.
        if (!item || held.has(id) || pinnedIds.has(id)) return [];

        remember(id, body.position);

        return [
          {
            id,
            x: body.position.x / WORLD_WIDTH,
            y: body.position.y / WORLD_HEIGHT,
            // Size and proportions are the item's own; gravity only moves and
            // turns things.
            size: item.size,
            aspect: item.aspect,
            rotation: ((body.angle * 180) / Math.PI) % 360,
            flipX: item.flipX,
            flipY: item.flipY,
          },
        ];
      }),

    dispose: () => {
      Composite.clear(engine.world, false);
      Engine.clear(engine);
      bodies.clear();
      held.clear();
      launched.clear();
      pinnedIds.clear();
      reported.clear();
    },
  };
}
