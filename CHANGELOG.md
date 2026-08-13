# Changelog

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
