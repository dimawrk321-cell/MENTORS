"use client";

import { useEffect } from "react";

// DECISION: global-error replaces the root layout, so globals.css / tokens.css are
// not guaranteed to be loaded — minimal inline styles duplicate the dark-theme
// values (#0B0C0E / #EDEEF0 / accent #5E6AD2) and the system font stack here.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="ru" suppressHydrationWarning>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0B0C0E",
          color: "#EDEEF0",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
            padding: 24,
            textAlign: "center",
          }}
        >
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Что-то пошло не так</h1>
          <p style={{ margin: 0, fontSize: 14, color: "#9BA0A8" }}>Попробуй ещё раз</p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 8,
              height: 36,
              padding: "0 16px",
              borderRadius: 10,
              border: "none",
              background: "#5E6AD2",
              color: "#FFFFFF",
              fontFamily: "inherit",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Повторить
          </button>
        </div>
      </body>
    </html>
  );
}
