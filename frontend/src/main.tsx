import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Cascade order: the layer statement first, then scale tokens, themes and components (all
// layered). Third-party CSS below is unlayered.
import "./styles/layers.css";
import "./styles/tokens.css";
// Deprecated 0.1 token names, read-only aliases (not part of the contract).
import "./styles/legacy.css";
import "./styles/themes/graphite.css";
import "./styles/themes/graphite-dark.css";
import "./styles/themes/editorial.css";
import "./styles/themes/midnight.css";
import "./styles/components/shell.css";
import "./styles/components/sidebar.css";
import "./styles/components/header.css";
import "./styles/components/composer.css";
import "./styles/components/empty.css";
import "./styles/components/login.css";
import "./styles/components/drawer.css";
import "./styles/components/message.css";
import "./styles/components/markdown.css";
import "./styles/components/code.css";
import "./styles/components/activity.css";
import "./styles/components/widget.css";
import "./styles/components/error.css";
import "./styles/components/attachment.css";
// KaTeX's CSS is functional (math layout and fonts), so it stays as shipped.
import "katex/dist/katex.min.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
