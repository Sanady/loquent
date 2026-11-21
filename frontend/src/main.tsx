import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Cascade order: the layer statement first, then scale tokens, themes and components (all
// layered). Third-party and legacy CSS below is unlayered.
import "./styles/layers.css";
import "./styles/tokens.css";
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
import "katex/dist/katex.min.css";
import "highlight.js/styles/github.css";
// interim: removed in Task 6. Legacy conversation styles, until they move onto the tokens.
import "./styles.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
