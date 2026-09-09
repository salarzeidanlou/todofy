import { render } from "preact";
import { QuickCapture } from "./components/QuickCapture";
import { ContextMenu } from "./components/ContextMenu";
import { applyTheme, initialTheme } from "./lib/theme";
import { initLocale } from "./lib/locale";
import "./styles/global.css";

// Match the main window's theme; the window itself is transparent so only the
// floating card is visible.
applyTheme(initialTheme());
document.body.style.background = "transparent";

// The capture bar shows parsed dates and times, so it needs the same clock and
// calendar conventions the main window resolved.
initLocale().finally(() => {
  render(
    <>
      <QuickCapture />
      <ContextMenu />
    </>,
    document.getElementById("root")!,
  );
});
