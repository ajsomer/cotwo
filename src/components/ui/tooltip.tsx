"use client";

import { useState, useRef, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  content: string;
  children: ReactNode;
  position?: "top" | "bottom";
}

export function Tooltip({ content, children, position = "top" }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setCoords({
      x: rect.left + rect.width / 2,
      y: position === "top" ? rect.top : rect.bottom,
    });
    setVisible(true);
  }, [position]);

  return (
    <div
      ref={triggerRef}
      className="inline-flex"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible &&
        createPortal(
          <div
            className="fixed z-[9999] pointer-events-none"
            style={{
              left: coords.x,
              top: coords.y,
              transform:
                position === "top"
                  ? "translate(-50%, -100%) translateY(-8px)"
                  : "translate(-50%, 0) translateY(8px)",
            }}
          >
            <div className="whitespace-nowrap px-2.5 py-1 rounded-full bg-gray-800 text-white text-xs font-medium shadow-lg">
              {content}
              {/* Caret */}
              <span
                className={`absolute left-1/2 -translate-x-1/2 w-0 h-0 border-x-[5px] border-x-transparent ${
                  position === "top"
                    ? "top-full border-t-[5px] border-t-gray-800"
                    : "bottom-full border-b-[5px] border-b-gray-800"
                }`}
              />
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
