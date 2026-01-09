"use client";
import React, { useRef, useState } from "react";

export default function HorizontalScroller({ children }) {
  const containerRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const startScrollLeftRef = useRef(0);
  const hasDraggedRef = useRef(false);

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

  const endDrag = () => {
    setIsDragging(false);
    // Keep hasDraggedRef until next click capture, then reset there
  };

  const dragMove = (clientX) => {
    const el = containerRef.current;
    if (!el || !isDragging) return;
    const x = clientX - el.getBoundingClientRect().left;
    const walk = (x - startXRef.current) * 1; // drag speed multiplier
    el.scrollLeft = startScrollLeftRef.current - walk;
    if (Math.abs(walk) > 8) {
      hasDraggedRef.current = true;
    }
  };

  const onMouseMove = (e) => {
    if (!isDragging) return;
    e.preventDefault();
    dragMove(e.clientX);
  };

  const onTouchMove = (e) => {
    if (!isDragging) return;
    dragMove(e.touches[0].clientX);
  };

  return (
    <div
      ref={containerRef}
      className="overflow-x-auto overflow-y-hidden no-scrollbar cursor-grab active:cursor-grabbing select-none"
      style={{ WebkitOverflowScrolling: "touch" }}
      onMouseDown={onMouseDown}
      onMouseLeave={endDrag}
      onMouseUp={endDrag}
      onMouseMove={onMouseMove}
      onTouchStart={onTouchStart}
      onTouchEnd={endDrag}
      onTouchMove={onTouchMove}
      onDragStart={(e)=> e.preventDefault()}
      onClickCapture={(e) => {
        if (hasDraggedRef.current) {
          e.preventDefault();
          e.stopPropagation();
          // reset after canceling one click
          hasDraggedRef.current = false;
        }
      }}
    >
      {children}
    </div>
  );
}


