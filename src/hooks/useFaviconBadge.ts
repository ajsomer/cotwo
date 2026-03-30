"use client";

import { useEffect, useRef } from "react";
import type { RunsheetSummary } from "@/lib/supabase/types";

/**
 * Swaps the favicon to include a red notification dot when attention is required.
 * Uses a canvas to draw the dot dynamically.
 */
export function useFaviconBadge(summary: RunsheetSummary) {
  const originalHref = useRef<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const link =
      document.querySelector<HTMLLinkElement>('link[rel="icon"]') ??
      document.createElement("link");

    if (!originalHref.current) {
      originalHref.current = link.href || "/favicon.ico";
    }

    const needsBadge = summary.late > 0 || summary.waiting > 0;

    if (!needsBadge) {
      link.href = originalHref.current;
      return;
    }

    // Create badge favicon using canvas
    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
      canvasRef.current.width = 32;
      canvasRef.current.height = 32;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = originalHref.current;

    img.onload = () => {
      ctx.clearRect(0, 0, 32, 32);
      ctx.drawImage(img, 0, 0, 32, 32);

      // Draw red dot in top-right corner
      ctx.beginPath();
      ctx.arc(24, 8, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#E24B4A";
      ctx.fill();
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      link.type = "image/x-icon";
      link.rel = "icon";
      link.href = canvas.toDataURL();

      // Ensure it's in the document
      if (!link.parentNode) {
        document.head.appendChild(link);
      }
    };

    img.onerror = () => {
      // If favicon can't be loaded, create a simple badge
      ctx.clearRect(0, 0, 32, 32);

      // Teal background
      ctx.beginPath();
      ctx.arc(16, 16, 14, 0, Math.PI * 2);
      ctx.fillStyle = "#2ABFBF";
      ctx.fill();

      // "C" letter
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 18px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("C", 16, 17);

      // Red dot
      ctx.beginPath();
      ctx.arc(24, 8, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#E24B4A";
      ctx.fill();

      link.type = "image/x-icon";
      link.rel = "icon";
      link.href = canvas.toDataURL();

      if (!link.parentNode) {
        document.head.appendChild(link);
      }
    };

    return () => {
      if (originalHref.current) {
        link.href = originalHref.current;
      }
    };
  }, [summary.late, summary.waiting]);
}
