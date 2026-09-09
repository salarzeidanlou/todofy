# Changelog

## v1.10.0 — 2026-09-09

### Added

- **Task estimates** — give a task an expected length and see it on the task row and in its details. Pick a common length (15m up to 2h) or type your own — **"90"**, **"1h30"**, **"1.5h"**, and **"1:30"** all mean the same thing. Estimates can be set while capturing a task in the quick-add bar, and they sync with your account. Self‑hosters apply the new `task_estimate` migration
- **Estimate vs. actual** — once a task passes the time you estimated for it, its tracked time turns **red** and shows how far over it has gone, on the task row, in the task's details, and in the focus card. The tray clock shows the overrun too (`12:30 +2:30`), so it's visible with the window closed. The overrun counts every session the task has had, so it survives a pause and stays visible after you stop
- **Pause a task timer** — timing a task now has start, pause, and stop. Pausing holds the clock without ending the session, so a break, a phone call, or a meeting doesn't get recorded as work; resuming picks up from where the clock stopped. The controls sit on the task row, in the task's details, in the focus card, and in the tray menu, and they stay visible on the task being timed instead of appearing only on hover
- **Choose what a task's play button does** — **Settings → Task timer** now offers **Stopwatch** (the default: it times how long the task takes) or **Pomodoro** (it also starts a focus countdown for that task, so the two clocks start, pause, resume, and stop together). Previously the button started a stopwatch while the focus window counted down a separate, unrelated Pomodoro, which was impossible to make sense of
- **Reminders can keep asking** — **Settings → Notifications** can now repeat an unanswered reminder every 2, 5, or 10 minutes instead of showing it once. It stops as soon as you answer it: opening, dismissing, or snoozing the notification, completing the task, or starting to time it. A notification that simply times out on screen doesn't count — that's a reminder you never saw. Off by default
- **Reminder sounds** — reminders can play a sound: **Chime**, **Ping**, **Bell**, or your own audio file, with a volume slider. The built-in tones are generated rather than recorded, so they add nothing to the download. A custom sound is stored inside todofy, so it keeps working if you later move or delete the file you picked (up to 1 MB). There's also **get louder each time a reminder repeats**, which starts a repeating reminder quiet and builds to your set volume over four rounds. New installs default to Chime; **set the sound to Silent** if you'd rather todofy stayed quiet
- **Date & time preferences** — a new section in **Settings** to choose a 12- or 24-hour clock and which day your week starts on. Both default to **Auto**, which follows your system, and the setting shows you what Auto currently resolves to
- **Editable quick times** — the one-tap times in the date picker were fixed at 9:00, 12:00 and 18:00 with no way to change them. **Settings → Date & time** now lists them: click one to remove it, add your own with the time field, up to four. Remove them all and the picker just shows the time field

### Changed

- **todofy now follows your system's clock and calendar conventions.** Times appear in your locale's 12- or 24-hour format, and the calendar, the date picker, and the day rail all start the week on the right day — Monday across most of the world, Sunday or Saturday where that's the convention. Previously the week always started on Sunday, and the clock followed the app window rather than your desktop's regional settings
- **Reworked time entry** — the date picker's time control is no longer the system time box. It's now a themed **HH:MM** field that follows your locale's 12- or 24-hour convention: arrow keys nudge the hour and minutes, typing `:` jumps to the minutes, and the hour moves on by itself once it can't take another digit. The same field replaces the start and end time boxes when editing a calendar event, where the old control also ignored the light theme
- **Repeat now lives in the date picker**, next to the date and time it applies to, instead of in a separate dropdown beside it. Pick **Never**, **Daily**, **Weekdays**, **Weekly**, **Monthly** or **Yearly** while you're already choosing when the task is due. A repeating task shows its rule in the task's details as well as on the task row
- **Tracked time counts up while you work** — a task being tracked now shows its time climbing on the task row and in its details, highlighted while it runs, instead of showing the old total until you stopped the timer
- **The task timer button says what it does.** It used to read "Begin 15 min" while actually starting an open-ended stopwatch, with the 25-minute Pomodoro running separately and unrelated. It now reads **Track time** (or **Start focus** in Pomodoro mode), then **Pause** or **Resume**, and a stop button appears beside it while a session is open
- **Reminder notifications stay put** — todofy's own notification card no longer vanishes on a fixed timer while you're reading it. Hovering the card holds it open as intended, and it now waits ten seconds rather than six

### Fixed

- A task whose reminder time has passed now reads as overdue instead of sitting quietly as "Today". The due date and the reminder both turn red once the time is behind you, and views keep up with the clock on their own — a task turns overdue while you're looking at it, and todofy left open overnight no longer shows yesterday's "Today"
- A time typed into the date picker is no longer lost. It's kept the moment it's complete, so dismissing the picker keeps it, and pressing Enter sets the time instead of saving the whole task
- Reminders can now be snoozed straight from the notification — **15m**, **30m**, or **1h** — instead of only from the in-app toast, which the default notification style never showed
- An empty task list caused by a failed load. If one part of your data couldn't be read at startup, todofy showed an empty list in every view — including tasks you added afterwards — with no indication anything had gone wrong. Each part now loads on its own, so a problem with one never hides the rest, and todofy tells you what failed and offers to retry
- **`todofy.db` is now a complete database on its own.** Recent changes were held in a companion `todofy.db-wal` file and only folded into the main file occasionally, so copying `todofy.db` for a backup could produce a file that looked empty. todofy now folds it in when you close the window to the tray and when you quit

## v1.9.0 — 2026-09-06

### Added

- **Sign in with Google** — sign in or sign up with your Google account straight from the Account modal, alongside the existing email and password. Authentication opens in your system browser and returns through a PKCE-protected loopback callback on `127.0.0.1`; the browser shows a clear success or error page only after Todofy finishes creating the session, with a button to return to the app. Self-hosters enable it by adding a Google OAuth provider in Supabase (see the README)
- **Delete your account** — a new option in **Settings → Account** permanently deletes your account and all of its cloud data, with a clear type‑to‑confirm step and an optional checkbox to also wipe the copy stored on this device. Deleting the account cascades to every synced table, so nothing is left behind. Self‑hosters deploy the new `delete-account` edge function
- **Local calendar** — a new Calendar workspace brings month, week, and day views to todofy. Tasks appear on their due dates, and standalone all-day or timed events can be created, edited, and deleted directly in the calendar. Standalone events stay private to this device and are not included in account sync or pushed to Google
- **Google Calendar sync** — connect Google Calendar in **Settings → Calendar** to push your tasks one‑way to a dedicated **todofy** calendar, so dated tasks show up next to your meetings. Tasks with a due date become all‑day events and tasks with a reminder become timed events; recurring tasks move as they roll forward, and deleting or un‑dating a task removes its event. By default completing a task clears its event, with a toggle to keep finished tasks (marked with a ✓) and another to push only tasks that have a set time. Disconnecting can optionally delete the todofy calendar and its events. Sign‑in uses Google's desktop loopback flow with PKCE and the narrow `calendar.app.created` scope, so todofy only ever touches the calendar it creates; tokens live in your OS secret store. It's opt‑in and gated behind account sign‑in. Self‑hosters enable the Google Calendar API and add a **Desktop app** OAuth client (see the README)

### Changed

- **Safe account switching** — Todofy now records which account owns the local sync data. When a different account signs in on the same installation, sync pauses and asks whether to load that account's cloud data or copy the current device data into it. Copying generates new UUIDs for the local sync graph so row-level security remains intact and records owned by the previous account are never overwritten

### Fixed

- Google account sign-in no longer gets stuck after a successful browser authorization in packaged builds. Todofy now owns the fixed `http://127.0.0.1:3369/auth-callback` listener, exchanges the returned code with Supabase, reports the real result in the browser, and reliably clears the in-app loading state
- Account sync no longer uploads active label assignments or focus sessions whose parent task or label has been deleted. Task and label deletion now tombstones dependent rows atomically, legacy orphaned rows are repaired at startup, and a final upload filter prevents foreign-key failures
- Signing in with another account no longer attempts to upsert local UUIDs already owned by the previous Supabase user, preventing the resulting `labels` row-level-security error without weakening RLS policies
- **Wipe local data** now removes standalone calendar events along with tasks, labels, focus sessions, and journal entries
- Timed standalone events now require their end time to be later than their start time

## v1.8.0 — 2026-09-02

### Added

- **Journal** — a new top-level view for writing free-form entries. Each entry has an optional title, a body with **Markdown** support (rendered and sanitized), and an optional 1–5 **mood**. Write as many entries per day as you like; they group under day headings, newest first
- **Day summary** — the composer offers a one-tap chip that inserts what you actually did that day (tasks completed and minutes focused), drawn from your tasks and focus history, as a low-friction writing prompt
- **Calendar rail markers** — days that have a journal entry are now dotted in the week rail, so it doubles as a way to see which days you've written
- **Journal shortcuts** — press `Shift`+`J` to jump into the Journal and start an entry; `n` now opens a new entry when you're already in the Journal (and a new task everywhere else). Both are listed in the `?` cheat-sheet
- **New journal** — added to the app context menu, right under **New task**
- **Journal account sync** — journal entries sync across devices on the same offline-first path as tasks: a per-user `journal_entries` table with row-level security, last-write-wins by `updated_at`, and deletion markers so removals propagate. Self-hosters apply the new journal and sync-tombstone migrations

### Changed

- **New design** — rebuilt the app as a calmer daily canvas with top navigation, a calendar-and-day rail, clearer task rows and detail views, and refreshed Focus, Settings, quick-capture, and notification surfaces

### Fixed

- Deleting a task, label, label assignment, focus session, or journal entry now records a content-free sync marker and physically removes the corresponding row from Supabase. Previously sync only uploaded `deleted_at`, leaving deleted content in the remote content table indefinitely

## v1.7.3 — 2026-08-28

### Fixed

- Account sync no longer fails with `insert or update on table "task_labels" violates foreign key constraint "task_labels_label_id_fkey"`. A label whose `updated_at` sat at or below the sync watermark (already synced, or stamped there when an older database was migrated) was skipped on push, yet assigning it to a task pushed the association — which then referenced a label the server had never seen. A changed association now carries its parent task and label along in the same push, so a child never lands ahead of its parent



### Fixed

- Account sign-in and sync work in packaged release builds again. Supabase configuration is now read at build time, and a build without it cleanly disables account sync (the Account section shows it as unavailable) rather than reaching out to a server

### Security

- Rotated the Supabase publishable key that shipped in earlier builds

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
