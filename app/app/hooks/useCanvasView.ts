"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clamp,
  fitView,
  MAX_ZOOM,
  MIN_ZOOM,
  type View,
} from "../lib/world";


const ZOOM_SENSITIVITY = 0.0015;

export function useCanvasView() {
  const [view, setView] = useState<View>(() => fitView(1280, 720));

  const hasFitted = useRef(false);

  const reset = useCallback(() => {
    setView(fitView(window.innerWidth, window.innerHeight));
  }, []);

  useEffect(() => {
    if (hasFitted.current) return;
    hasFitted.current = true;
    setView(fitView(window.innerWidth, window.innerHeight));
  }, []);


  const zoomAt = useCallback(
    (screenX: number, screenY: number, factor: number) => {
      setView((prev) => {
        const zoom = clamp(prev.zoom * factor, MIN_ZOOM, MAX_ZOOM);

        if (zoom === prev.zoom) return prev;

        const ratio = zoom / prev.zoom;
        return {
          zoom,
          x: screenX - (screenX - prev.x) * ratio,
          y: screenY - (screenY - prev.y) * ratio,
        };
      });
    },
    [],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      zoomAt(window.innerWidth / 2, window.innerHeight / 2, factor);
    },
    [zoomAt],
  );

  const containerRef = useCallback(
    (container: HTMLDivElement | null) => {
      if (!container) return;

      const onWheel = (event: WheelEvent) => {
        event.preventDefault();
        zoomAt(
          event.clientX,
          event.clientY,
          Math.exp(-event.deltaY * ZOOM_SENSITIVITY),
        );
      };

      container.addEventListener("wheel", onWheel, { passive: false });
      return () => container.removeEventListener("wheel", onWheel);
    },
    [zoomAt],
  );

  const startPan = useCallback((event: React.PointerEvent<HTMLElement>) => {

    if (event.button !== 0 && event.button !== 1) return;

    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    element.classList.add("is-panning");




    let lastX = event.clientX;
    let lastY = event.clientY;

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      setView((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
    };

    const onEnd = () => {
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerup", onEnd);
      element.removeEventListener("pointercancel", onEnd);
      element.classList.remove("is-panning");
    };

    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerup", onEnd);
    element.addEventListener("pointercancel", onEnd);
  }, []);

  return { view, containerRef, startPan, zoomBy, reset };
}
