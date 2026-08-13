import { render } from "preact";
import { QuickCapture } from "./components/QuickCapture";
import { applyTheme, initialTheme } from "./lib/theme";
import "./styles/global.css";

// Match the main window's theme; the window itself is transparent so only the
// floating card is visible.
applyTheme(initialTheme());
document.body.style.background = "transparent";

render(<QuickCapture />, document.getElementById("root")!);
