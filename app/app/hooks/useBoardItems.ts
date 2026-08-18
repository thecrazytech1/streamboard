"use client";

import { useCallback, useEffect, useState } from "react";
import { socket } from "../../utils/socket";
import type { BoardItem, ItemTransform } from "@/types/board";


function merge(
  previous: Record<string, BoardItem>,
  transforms: ItemTransform[],
): Record<string, BoardItem> {
  const touched = transforms.filter(({ id }) => previous[id]);
  if (touched.length === 0) return previous;

  const next = { ...previous };
  for (const { id, ...transform } of touched) {
    next[id] = { ...next[id], ...transform };
  }
  return next;
}

export function useBoardItems() {
  const [items, setItems] = useState<Record<string, BoardItem>>({});

  useEffect(() => {
    const onSync = (list: BoardItem[]) => {
      setItems(Object.fromEntries(list.map((item) => [item.id, item])));
    };

    const onPlaced = (item: BoardItem) => {
      setItems((prev) => ({ ...prev, [item.id]: item }));
    };

    const onTransformed = (transform: ItemTransform) => {
      setItems((prev) => merge(prev, [transform]));
    };

    const onBatchTransformed = (transforms: ItemTransform[]) => {
      setItems((prev) => merge(prev, transforms));
    };

    const onReordered = ({ id, z }: { id: string; z: number }) => {
      setItems((prev) =>
        prev[id] ? { ...prev, [id]: { ...prev[id], z } } : prev,
      );
    };

    const onBatchReordered = (updates: Array<{ id: string; z: number }>) => {
      setItems((prev) => {
        const next = { ...prev };
        for (const { id, z } of updates) {
          if (next[id]) next[id] = { ...next[id], z };
        }
        return next;
      });
    };

    const onRemoved = (id: string) => {
      setItems((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    };

    const onBatchRemoved = (ids: string[]) => {
      setItems((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        return next;
      });
    };

    socket.on("item:sync", onSync);
    socket.on("item:placed", onPlaced);
    socket.on("item:transformed", onTransformed);
    socket.on("items:transformed", onBatchTransformed);
    socket.on("item:reordered", onReordered);
    socket.on("items:reordered", onBatchReordered);
    socket.on("item:removed", onRemoved);
    socket.on("items:removed", onBatchRemoved);

    return () => {
      socket.off("item:sync", onSync);
      socket.off("item:placed", onPlaced);
      socket.off("item:transformed", onTransformed);
      socket.off("items:transformed", onBatchTransformed);
      socket.off("item:reordered", onReordered);
      socket.off("items:reordered", onBatchReordered);
      socket.off("item:removed", onRemoved);
      socket.off("items:removed", onBatchRemoved);
    };
  }, []);


  const applyTransforms = useCallback((transforms: ItemTransform[]) => {
    setItems((prev) => merge(prev, transforms));
  }, []);

  return { items, applyTransforms };
}
