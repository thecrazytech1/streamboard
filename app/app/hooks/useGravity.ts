"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { socket } from "../../utils/socket";
import { type GravityMode, MAX_RUN_MS, simulate } from "../lib/physics";
import { isOnStream, WORLD_HEIGHT, WORLD_WIDTH } from "../lib/world";
import type { BoardItem, ItemTransform } from "@/types/board";

/**
 * How often the *network* hears about it. Matches the throttle a drag uses, so
 * everyone else — including the overlay — sees this as smoothly as they see
 * somebody dragging.
 *
 * The local view is not throttled to this. It updates every frame, because the
 * person who pressed the button is watching the simulation itself rather than
 * an echo of it.
 */
const SEND_INTERVAL_MS = 1000 / 25;

/** Below this, a body hasn't really moved and isn't worth a message. */
const MOVED_FRACTION = 0.0005;
const MOVED_DEGREES = 0.5;

/** Below this, nothing has visibly happened and React can be left alone. */
const STILL_FRACTION = 0.00002;
const STILL_DEGREES = 0.02;

/**
 * Gravity, as a toggle.
 *
 * Press once: the current arrangement is remembered and the items fall, pile up
 * against the bottom of the stream frame, and settle. Press again: everything
 * goes back where it was.
 *
 * The remembered arrangement lives here, in the client that started it — which
 * is why none of this needed a single line of server code. Falling is a stream
 * of ordinary transforms, and so is putting it all back.
 *
 * Only what's inside the stream frame takes part. Everything parked in the
 * staging area around it is left exactly where it is — that space is for things
 * waiting to go on, and having them slide into a heap would make it useless.
 *
 * Membership is re-checked every frame rather than fixed when it starts, so the
 * board stays editable while physics runs: drag an emote into frame and it
 * joins, drag one out and it settles where you left it, place a new one and it
 * falls in with the rest. No stopping and restarting to add something.
 *
 * Restoring puts items back rather than rewinding the board: anything placed
 * during the chaos stays, anything deleted stays deleted.
 *
 * While floating, dragging an item is how you throw it: the simulation watches
 * for items that moved on their own — yours or another editor's — and launches
 * them with the speed the drag gave them. See Simulation.reconcile.
 */
export function useGravity({
  items,
  onTransforms,
}: {
  items: Record<string, BoardItem>;
  /** Applies a batch locally, so the person who pressed it sees it smoothly. */
  onTransforms: (transforms: ItemTransform[]) => void;
}) {
  /** Which mode is running, or null when there's nothing to go back to. */
  const [active, setActive] = useState<GravityMode | null>(null);

  /**
   * Where each item was before physics touched it, keyed by id — a list would
   * be wrong now that items join an already-running simulation. An item's entry
   * is written once, when it joins, and is its way home.
   */
  const restorePoint = useRef<Map<string, ItemTransform> | null>(null);
  const frame = useRef<number | null>(null);
  const running = useRef<ReturnType<typeof simulate> | null>(null);

  // Read at the moment gravity starts rather than closed over, so the loop
  // never holds a stale board.
  const latest = useRef(items);
  useEffect(() => {
    latest.current = items;
  }, [items]);

  const apply = useRef(onTransforms);
  useEffect(() => {
    apply.current = onTransforms;
  }, [onTransforms]);

  const stopLoop = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    running.current?.dispose();
    running.current = null;
  }, []);

  /** On screen here, immediately. Cheap: no network, no round trip. */
  const applyLocally = useCallback((batch: ItemTransform[]) => {
    if (batch.length === 0) return;
    apply.current(batch);
  }, []);

  /** On everyone else's screen, including the overlay. */
  const broadcast = useCallback((batch: ItemTransform[]) => {
    if (batch.length === 0) return;
    socket.emit("items:transform", batch);
  }, []);

  const send = useCallback(
    (batch: ItemTransform[]) => {
      applyLocally(batch);
      broadcast(batch);
    },
    [applyLocally, broadcast],
  );

  /** Everything currently inside the stream frame, which is what simulates. */
  const inFrame = useCallback(
    () => Object.values(latest.current).filter((item) => isOnStream(item)),
    [],
  );

  /** Remembers where anything new is, before the simulation moves it. */
  const rememberHome = useCallback((items: readonly BoardItem[]) => {
    const home = restorePoint.current;
    if (!home) return;

    for (const item of items) {
      if (home.has(item.id)) continue;
      home.set(item.id, {
        id: item.id,
        x: item.x,
        y: item.y,
        size: item.size,
        aspect: item.aspect,
        rotation: item.rotation,
        flipX: item.flipX,
        flipY: item.flipY,
      });
    }
  }, []);

  const run = useCallback(
    (chosen: BoardItem[], mode: GravityMode) => {
      const simulation = simulate(chosen, mode);
      running.current = simulation;

      /** The last positions pushed into React, to avoid re-rendering for nothing. */
      const shown = new Map<string, ItemTransform>();
      const sent = new Map<string, ItemTransform>();

      let previous = performance.now();
      let sinceSend = 0;
      let elapsed = 0;

      const tick = (now: number) => {
        const delta = Math.min(now - previous, 100);
        previous = now;
        elapsed += delta;
        sinceSend += delta;

        // Who is playing, re-asked every frame: anything in the frame now, which
        // may be more or fewer items than a moment ago.
        const playing = inFrame();
        rememberHome(playing);
        simulation.sync(playing);

        // Where the items actually are, which is where the sim's bodies should
        // be — unless somebody has moved one, in which case this is how the
        // simulation finds out. Fractions back into world pixels, since that's
        // the space the bodies live in.
        simulation.reconcile(
          new Map(
            Object.entries(latest.current).map(([id, item]) => [
              id,
              { x: item.x * WORLD_WIDTH, y: item.y * WORLD_HEIGHT },
            ]),
          ),
          now,
        );

        simulation.step(delta);

        // Every frame, locally — the difference between watching a simulation
        // and watching a slideshow of one. Only what actually changed, though:
        // these runs don't end on their own any more, and re-rendering a
        // sleeping pile sixty times a second is pure waste.
        const current = simulation.read();
        const changed = current.filter((next) => {
          const last = shown.get(next.id);
          if (
            last &&
            Math.abs(last.x - next.x) < STILL_FRACTION &&
            Math.abs(last.y - next.y) < STILL_FRACTION &&
            Math.abs(last.rotation - next.rotation) < STILL_DEGREES &&
            last.size === next.size &&
            last.aspect === next.aspect
          ) {
            return false;
          }
          shown.set(next.id, next);
          return true;
        });
        applyLocally(changed);

        if (elapsed >= MAX_RUN_MS) {
          // The whole final state, unfiltered, before anything is torn down:
          // these are the positions that persist, and nothing should be left a
          // pixel out because it fell under the movement threshold.
          send(current);
          simulation.dispose();
          running.current = null;
          frame.current = null;
          return;
        }

        if (sinceSend >= SEND_INTERVAL_MS) {
          sinceSend = 0;

          // Only what actually moved. A settled pile drops out of the messages
          // within a second or two, which is what keeps this off the wire.
          const batch = changed.filter((next) => {
            const last = sent.get(next.id);
            if (
              last &&
              Math.abs(last.x - next.x) < MOVED_FRACTION &&
              Math.abs(last.y - next.y) < MOVED_FRACTION &&
              Math.abs(last.rotation - next.rotation) < MOVED_DEGREES
            ) {
              return false;
            }
            sent.set(next.id, next);
            return true;
          });

          // Already on screen here — this is the network's copy.
          broadcast(batch);
        }

        frame.current = requestAnimationFrame(tick);
      };

      frame.current = requestAnimationFrame(tick);
    },
    [applyLocally, broadcast, inFrame, rememberHome, send],
  );

  /**
   * `ids` picks what falls; everything on the board falls without it. Pressing
   * again puts the remembered arrangement back, whatever is still there.
   */
  /**
   * Starts a mode, or puts everything back if one is running.
   *
   * There's no argument for *what* takes part: it's whatever is inside the
   * stream frame, now and for as long as this runs. The selection doesn't come
   * into it — scoping physics to a selection would mean stopping and
   * restarting to involve anything else.
   */
  const toggle = useCallback(
    (mode: GravityMode = "drop") => {
      // Either button stops what's running and puts everything back. Switching
      // straight from one mode to the other would leave the arrangement you
      // started from stranded behind two presses.
      if (active) {
        stopLoop();

        const saved = restorePoint.current;
        restorePoint.current = null;
        setActive(null);

        // Items deleted mid-chaos are simply skipped — there's nothing to put
        // back, and the server would ignore them anyway.
        send(
          [...(saved?.values() ?? [])].filter(
            (transform) => latest.current[transform.id],
          ),
        );
        return;
      }

      const playing = inFrame();
      if (playing.length === 0) return;

      // Seeded here and added to as items join; see rememberHome.
      restorePoint.current = new Map();
      rememberHome(playing);

      setActive(mode);
      run(playing, mode);
    },
    [active, inFrame, rememberHome, run, send, stopLoop],
  );

  // A tab closing mid-fall leaves the items wherever they got to, which the
  // server already has — there's nothing to clean up but the loop.
  useEffect(() => stopLoop, [stopLoop]);

  /**
   * Told to us by the board layer when a drag starts and ends. Ignored unless
   * something is simulating, which is why these are safe to call always.
   */
  const grab = useCallback((ids: string[]) => {
    running.current?.grab(ids, performance.now());
  }, []);

  const release = useCallback((ids: string[]) => {
    running.current?.release(ids, performance.now());
  }, []);

  return { active, toggle, grab, release };
}
