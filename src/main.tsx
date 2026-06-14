// src/main.tsx
import "./webrtc-polyfill/install";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { installWebRtcPolyfill } from "./webrtc-polyfill";
import { applyThemeVariant, getInitialVariant } from "./theme/themeVariant";
import { App } from "./App";

await installWebRtcPolyfill();

document.documentElement.setAttribute("data-layout", "texlyre-wide");
document.documentElement.setAttribute("data-theme-plugin", "texlyre");
applyThemeVariant(getInitialVariant());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);