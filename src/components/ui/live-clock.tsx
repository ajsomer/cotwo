"use client";

import { useState, useEffect } from "react";

interface LiveClockProps {
  timezone?: string;
  className?: string;
}

export function LiveClock({ timezone = "Australia/Sydney", className = "" }: LiveClockProps) {
  const [time, setTime] = useState<string>("");

  useEffect(() => {
    function update() {
      setTime(
        new Date().toLocaleTimeString("en-AU", {
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
          timeZone: timezone,
        })
      );
    }

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [timezone]);

  if (!time) return null;

  return (
    <span className={`font-mono text-sm text-gray-500 ${className}`}>
      {time}
    </span>
  );
}
