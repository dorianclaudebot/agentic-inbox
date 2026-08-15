// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useCallback, useRef, useState, type PointerEvent } from "react";

const LOCK_PX = 8;
const EDGE_GUARD_PX = 24;
const DEFAULT_THRESHOLD_PX = 72;
const FLY_OUT_PX = 420;

type AxisLock = "none" | "horizontal" | "ignored";

interface GestureState {
  pointerId: number;
  startX: number;
  startY: number;
  lock: AxisLock;
  fromLeftEdge: boolean;
  didHaptic: boolean;
}

interface UseSwipeRowOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  enabledLeft?: boolean;
  enabledRight?: boolean;
  thresholdPx?: number;
}

function emptyGesture(): GestureState {
  return {
    pointerId: -1,
    startX: 0,
    startY: 0,
    lock: "none",
    fromLeftEdge: false,
    didHaptic: false,
  };
}

function clampDrag(dx: number, max: number): number {
  if (dx > max) return max + (dx - max) * 0.15;
  if (dx < -max) return -max + (dx + max) * 0.15;
  return dx;
}

/**
 * Horizontal swipe on touch pointers only. Vertical motion stays a scroll.
 * Right-swipe is ignored when it starts in the Android back-gesture edge.
 */
export function useSwipeRow({
  onSwipeLeft,
  onSwipeRight,
  enabledLeft = true,
  enabledRight = true,
  thresholdPx = DEFAULT_THRESHOLD_PX,
}: UseSwipeRowOptions) {
  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const offsetRef = useRef(0);
  const suppressClickRef = useRef(false);
  const gestureRef = useRef<GestureState>(emptyGesture());
  const optionsRef = useRef({
    onSwipeLeft,
    onSwipeRight,
    enabledLeft,
    enabledRight,
    thresholdPx,
  });
  optionsRef.current = {
    onSwipeLeft,
    onSwipeRight,
    enabledLeft,
    enabledRight,
    thresholdPx,
  };

  const setOffsetBoth = (value: number) => {
    offsetRef.current = value;
    setOffset(value);
  };

  const endGesture = useCallback((target: HTMLElement, pointerId: number) => {
    if (target.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
    const { onSwipeLeft, onSwipeRight, enabledLeft, enabledRight, thresholdPx } =
      optionsRef.current;
    const gesture = gestureRef.current;
    const dx = offsetRef.current;
    gestureRef.current = emptyGesture();
    setIsDragging(false);

    if (gesture.lock !== "horizontal") {
      setOffsetBoth(0);
      return;
    }

    suppressClickRef.current = true;
    if (dx <= -thresholdPx && enabledLeft) {
      setOffsetBoth(-FLY_OUT_PX);
      onSwipeLeft?.();
      return;
    }
    if (dx >= thresholdPx && enabledRight && !gesture.fromLeftEdge) {
      setOffsetBoth(0);
      onSwipeRight?.();
      return;
    }
    setOffsetBoth(0);
  }, []);

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch") return;
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lock: "none",
      fromLeftEdge: event.clientX < EDGE_GUARD_PX,
      didHaptic: false,
    };
  }, []);

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (gesture.pointerId !== event.pointerId) return;

    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    const { enabledLeft, enabledRight, thresholdPx } = optionsRef.current;

    if (gesture.lock === "none") {
      if (Math.abs(dx) < LOCK_PX && Math.abs(dy) < LOCK_PX) return;
      if (Math.abs(dy) >= Math.abs(dx) || (dx > 0 && gesture.fromLeftEdge)) {
        gesture.lock = "ignored";
        return;
      }
      gesture.lock = "horizontal";
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsDragging(true);
    }

    if (gesture.lock !== "horizontal") return;

    let next = dx;
    if (next > 0 && (!enabledRight || gesture.fromLeftEdge)) next = 0;
    if (next < 0 && !enabledLeft) next = 0;
    next = clampDrag(next, thresholdPx * 1.75);

    if (!gesture.didHaptic && Math.abs(next) >= thresholdPx) {
      gesture.didHaptic = true;
      navigator.vibrate?.(10);
    }
    if (Math.abs(next) < thresholdPx) gesture.didHaptic = false;

    event.preventDefault();
    setOffsetBoth(next);
  }, []);

  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (gestureRef.current.pointerId !== event.pointerId) return;
      endGesture(event.currentTarget, event.pointerId);
    },
    [endGesture],
  );

  const onPointerCancel = useCallback((event: PointerEvent<HTMLElement>) => {
    if (gestureRef.current.pointerId !== event.pointerId) return;
    gestureRef.current = emptyGesture();
    setIsDragging(false);
    setOffsetBoth(0);
  }, []);

  const consumeClick = useCallback(() => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }, []);

  return {
    offset,
    isDragging,
    consumeClick,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    },
  };
}
