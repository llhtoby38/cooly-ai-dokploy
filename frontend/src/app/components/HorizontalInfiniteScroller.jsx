"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";

export default function HorizontalInfiniteScroller({ children, gapClass = "gap-4", repeatCount = 6, autoScroll = true, speed = 0.4 }) {
  const containerRef = useRef(null);
  const seq0Ref = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const startScrollLeftRef = useRef(0);
  const hasDraggedRef = useRef(false);
  const singleWidthRef = useRef(0);
  const pausedRef = useRef(false);

  const measureAndCenter = () => {
    const el = containerRef.current;
    const seq0 = seq0Ref.current;
    if (!el || !seq0) return;
    const w = seq0.getBoundingClientRect().width;
    singleWidthRef.current = w;
    const centerIndex = Math.max(1, Math.floor(repeatCount / 2));
    el.scrollLeft = w * centerIndex; // start near the middle, no recentering after
  };

  useEffect(() => {
    measureAndCenter();
    const onResize = () => measureAndCenter();
    window.addEventListener('resize', onResize);

    // Observe width changes of the first sequence to recompute w after images/fonts load
    const seq0 = seq0Ref.current;
    let ro;
    if (seq0 && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        measureAndCenter();
      });
      ro.observe(seq0);
    }
    return () => {
      window.removeEventListener('resize', onResize);
      if (ro) ro.disconnect();
    };
  }, []);

  // Auto-scroll loop (no snapping; wrap seamlessly when needed)
  useEffect(() => {
    if (!autoScroll) return;
    let rafId;
    const tick = () => {
      const el = containerRef.current;
      const w = singleWidthRef.current;
      if (el && w && !isDragging && !pausedRef.current) {
        el.scrollLeft += speed;
        const maxLeft = w * (repeatCount - 2);
        if (el.scrollLeft >= maxLeft) {
          el.scrollLeft -= w; // wrap forward
        } else if (el.scrollLeft <= w * 0.5) {
          el.scrollLeft += w; // wrap backward safeguard
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [autoScroll, speed, repeatCount, isDragging]);

  // No re-centering scroll handler to avoid snap perception

  const beginDrag = (clientX) => {
    const el = containerRef.current;
    if (!el) return;
    setIsDragging(true);
    startXRef.current = clientX - el.getBoundingClientRect().left;
    startScrollLeftRef.current = el.scrollLeft;
    hasDraggedRef.current = false;
  };
  const onMouseDown = (e) => beginDrag(e.clientX);
  const onTouchStart = (e) => beginDrag(e.touches[0].clientX);
  const endDrag = () => setIsDragging(false);
  const dragMove = (clientX) => {
    const el = containerRef.current;
    if (!el || !isDragging) return;
    const x = clientX - el.getBoundingClientRect().left;
    const walk = (x - startXRef.current) * 1;
    el.scrollLeft = startScrollLeftRef.current - walk;
    if (Math.abs(walk) > 8) hasDraggedRef.current = true;
  };
  const onMouseMove = (e) => { if (!isDragging) return; e.preventDefault(); dragMove(e.clientX); };
  const onTouchMove = (e) => { if (!isDragging) return; dragMove(e.touches[0].clientX); };

  const childArray = useMemo(() => React.Children.toArray(children), [children]);
  const renderSequence = (suffix) => (
    <div className={`flex ${gapClass} min-w-0`}>
      {childArray.map((child, idx) => {
        if (React.isValidElement(child)) {
          const key = child.key != null ? String(child.key) : String(idx);
          return React.cloneElement(child, { key: `seq${suffix}-${key}` });
        }
        return <React.Fragment key={`seq${suffix}-${idx}`}>{child}</React.Fragment>;
      })}
    </div>
  );

  return (
    <div
      ref={containerRef}
      className="overflow-x-auto overflow-y-hidden no-scrollbar cursor-grab active:cursor-grabbing select-none"
      style={{ WebkitOverflowScrolling: "touch" }}
      onMouseEnter={() => { pausedRef.current = true; }}
      onMouseLeave={(e) => { pausedRef.current = false; endDrag(); }}
      // intentionally no onScroll recentring to avoid snapping
      onMouseDown={onMouseDown}
      onMouseUp={endDrag}
      onMouseMove={onMouseMove}
      onTouchStart={(e)=>{ pausedRef.current = true; onTouchStart(e); }}
      onTouchEnd={(e)=>{ pausedRef.current = false; endDrag(); }}
      onTouchMove={onTouchMove}
      onDragStart={(e)=> e.preventDefault()}
      onClickCapture={(e) => {
        if (hasDraggedRef.current) {
          e.preventDefault();
          e.stopPropagation();
          hasDraggedRef.current = false;
        }
      }}
    >
      <div className={`flex ${gapClass} min-w-0 flex-nowrap`}>
        {Array.from({ length: repeatCount }, (_, i) => (
          <div
            key={`seq-${i}`}
            ref={i === 0 ? seq0Ref : undefined}
            className="flex min-w-0 flex-none"
            aria-hidden={i !== 0}
          >
            {renderSequence(i)}
          </div>
        ))}
      </div>
    </div>
  );
}


