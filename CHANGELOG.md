# Changelog

## v1.7.1 — 2026-08-27

### Fixed

- Account sign-in and sync failed with a "Load failed" error in the 1.7.0 release build. The packaged app's Content-Security-Policy didn't allow the Supabase origin in `connect-src`, so every auth and sync request was blocked by the webview. Supabase's `https`/`wss` origins are now permitted
- The Supabase publishable key was read from a `NEXT_PUBLIC_*` environment variable that Vite never exposes to the client; it's now read from `VITE_SUPABASE_PUBLISHABLE_KEY`

### Changed

- Added a show/hide toggle to the password field in the sign-in modal
- Hovering the "Create an account" / "Sign in" link now highlights only the link text, not the whole line

## v1.7.0 — 2026-08-27

### Added

- Account sync — sign in with an email and password (Settings → Account) to sync your tasks, labels, focus sessions, and their history across devices, backed by Supabase. It's fully optional and additive: todofy still works exactly as before with no account, entirely offline and local-first. Sign-in and sign-up happen in a polished in-app modal, with a live sync-status indicator (last synced, syncing, offline, or failed) and a manual **Sync now** button
- Sessions are stored in your operating system's secret store (libsecret / Keychain / Credential Manager) rather than in the app's web storage, falling back gracefully where no keychain is available

### Changed

- Redesigned the notification popup — a cleaner card with a ringed icon and a slim auto-dismiss progress bar that pauses while you hover
- A custom right-click menu replaces the webview's browser one (Back / Forward / Reload / Inspect Element) — a clean todofy menu with context-aware **Cut / Copy / Paste / Select all** on text fields (with shortcut hints) plus quick **New task**, **Settings**, and theme toggle actions

### Fixed

- The notification popup can no longer get "stuck" as an invisible, click-blocking window in a screen corner. If its content ever failed to draw (for example, the popup window loaded a beat after the reminder fired), the transparent always-on-top frame could linger and swallow clicks; it now reliably shows its content and always hides itself, with a backend safety timeout as a backstop

## v1.6.0 — 2026-08-25

### Added

- Search & filters — a search bar on every task view narrows the list by title and notes as you type, with filter chips for priority and labels layered on top; press `/` to jump to search, and clear everything with one click

### Fixed

- Focus timers no longer run forever if you forget to stop them — a task stopwatch or Pomodoro segment left running past 12 hours (e.g. overnight, or the app was closed and reopened days later) is now auto-stopped and capped at that limit. Previously an open session's start time was read straight from the database, so a forgotten timer's elapsed time could balloon indefinitely and simply killing/restarting the app did nothing to clear it

## v1.5.0 — 2026-08-22

### Added

- Subtasks / checklists — break a task into steps in the detail panel, with a live progress bar; the task row shows a `done/total` badge that turns green when everything's checked off
- Overdue rescue — a one-click "Reschedule to today" button on the Today view moves every overdue task forward at once, and overdue tasks now carry a calm red accent bar so they're easy to spot without being alarming
- Relative due dates — dates are phrased relative to today (_"in 3 days"_, _"3 weeks ago"_, _"Tomorrow"_), falling back to a calendar date for anything more than a month out
- Completion celebration — finishing a task can play a small confetti burst, and the Today header shows a "done today" count and a day streak; the celebration is optional (Settings → Appearance) and automatically skipped when the system prefers reduced motion
- Keyboard shortcuts cheat-sheet — press `?` anywhere (or open it from Settings → Keyboard) to see every shortcut
- Quick-capture discoverability — empty states and a new Settings → Quick capture entry surface the global **Ctrl+Alt+A** hotkey and the `?` cheat-sheet
- Reduced-motion support — todofy now honors the OS "reduce motion" setting, disabling entrance animations and transitions

### Changed

- The task detail panel now closes when you click anywhere in the main list area, not only via the ✕ button or `Esc`

### Fixed

- Drag-and-drop reordering now works reliably inside the app — the previous implementation used the browser's native drag-and-drop, which the Linux (WebKitGTK) webview handles inconsistently, so dropping a task often did nothing; it's been rebuilt on pointer events

## v1.4.0 — 2026-08-19

### Added

- Custom notification popup — reminders and timer nudges can show as todofy's own borderless, always-on-top card pinned to a screen corner, above other apps, instead of an OS notification. Click it to open the task; it auto-dismisses (and pauses while hovered)
- Notification settings — choose between the in-app popup and system notifications, and pick which screen corner the popup appears in (Settings → Notifications)
- Reminders for date-only tasks — a task with a due date but no specific time now notifies at 9:00 AM on the due day

### Changed

- Desktop notifications are now delivered through the XDG desktop portal, which is more reliable than the classic notification interface on some Linux sessions; the previous path remains as a fallback
- The Settings "Send test" notification uses the same delivery path as real reminders and reports how it was routed

## v1.3.0 — 2026-08-16

### Added

- Focus timers — two independent, backend-tracked timers that keep counting while todofy is hidden in the tray and survive a restart:
  - Pomodoro (focus / short break / long break) with Start·Pause, Reset, and Skip, plus configurable phase lengths
  - Per-task stopwatch — press play on any task to track time on it; each session is recorded and the task shows its total focused time
  - Neither timer auto-stops: when a phase finishes or a stopwatch runs long, todofy sends a notification and keeps counting
- Focus screen — a dedicated page to start the Pomodoro, tune its lengths, and browse focus history (Today / This week / Tracked-total, grouped by day); opens from the floating focus widget
- Focus widget — a floating timer panel (bottom-left) with live countdowns, opened from the sidebar
- Tray timer controls — start/pause the Pomodoro and stop the task stopwatch from the tray menu, with a live status line and a countdown shown on the tray icon
- Recurring tasks — set a task to repeat Daily, Every weekday, Weekly, Monthly, or Yearly; completing it rolls the due date and reminder to the next occurrence instead of finishing it. Also parsed from natural language ("water plants every week")
- Settings screen — with run-on-startup (launch todofy at login, opening the window or starting quietly in the tray)

### Changed

- Pomodoro length settings live on the Focus screen (not the Settings screen)
- Theme toggle moved from the sidebar into Settings → Appearance
- The main window now starts hidden and is revealed by the backend, so a tray-mode login launch no longer flashes a window
- Content Security Policy is now enabled (previously disabled)

### Fixed

- Clearing a task's date, reminder, or notes is no longer a silent no-op — a serde `Option<Option<T>>` quirk had been collapsing an explicit `null` into "leave unchanged"

## v1.2.0 — 2026-08-13

### Added

- Global quick-add (Ctrl+Alt+A) — a floating capture window that opens from anywhere, even when todofy is hidden in the tray; type a task (with natural-language parsing), press Enter, and it lands in your list without switching windows
- Drag-and-drop reordering — grab any task and drop it into place; manual order is now the primary sort (priority is a color-coded tag, not a sort key). Order persists via a fractional index, so a reorder only rewrites the moved task
- Natural-language quick-add — type "pay rent friday 5pm #home p1" and the date, time, priority, and labels are parsed out live, shown as preview chips, and stripped from the saved title (powered by chrono-node)

## v1.1.0 — 2026-08-13

### Added

- Pinboard view — see all pinned tasks in one place
- Task pinning — pin/unpin from the task row or detail panel, or press `p`; pinned tasks float to the top of their group
- Completed view — every finished task app-wide, newest first
- Labels page — searchable label list with edit/delete, moved out of the sidebar
- Premium color picker for labels — 16-color preset grid plus a custom hex input, styled to match the app's other popovers

### Changed

- Task detail panel now opens as a floating overlay instead of pushing the task list left
- "Mark complete" button shows a visible outlined checkmark instead of a blank circle
- Today view no longer keeps showing a task after it was completed on a previous day

### Fixed

- Database migration ordering bug that crashed startup on existing databases when adding the `pinned` column

## v1.0.0 — 2026-08-12

### Added

- Smart views: Today, Upcoming, Inbox
- Labels: create, rename, recolor, delete, filter by label
- Quick-add tasks with due date, reminder, priority, labels
- Task detail panel: edit title/notes, due date, reminder, priority, labels
- Date-grouped task lists (Overdue/Today, Upcoming by date)
- Reminders: presets, snooze, in-app toasts, OS notifications
- Keyboard shortcuts: quick-add, navigate, edit, complete, delete, close
- Light/dark theme toggle
- Collapsible sidebar
- Custom calendar date picker
- Confirm dialog for deletes
- System tray with show/quit, minimize-to-tray
- Single-instance app enforcement
- Linux packaging (deb/rpm/AppImage)
