import type { JSX } from "preact";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import {
  ArrowCounterClockwiseIcon,
  ArrowSquareOutIcon,
  ArrowsOutIcon,
  BellIcon as PhBellIcon,
  CalendarBlankIcon,
  CalendarDotsIcon,
  CalendarIcon as PhCalendarIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckCircleIcon as PhCheckCircleIcon,
  CheckIcon as PhCheckIcon,
  DotsSixVerticalIcon,
  EyeIcon as PhEyeIcon,
  EyeSlashIcon,
  FlagIcon as PhFlagIcon,
  GearSixIcon,
  GithubLogoIcon,
  GlobeSimpleIcon,
  HourglassMediumIcon,
  LightningIcon,
  ListIcon as PhListIcon,
  MagnifyingGlassIcon,
  MoonIcon as PhMoonIcon,
  NotebookIcon as PhNotebookIcon,
  NotePencilIcon,
  PauseIcon as PhPauseIcon,
  PencilSimpleIcon,
  PlayIcon as PhPlayIcon,
  PlusIcon as PhPlusIcon,
  PowerIcon as PhPowerIcon,
  PushPinIcon,
  RepeatIcon as PhRepeatIcon,
  SkipForwardIcon,
  StopIcon as PhStopIcon,
  SunIcon as PhSunIcon,
  TagIcon,
  TimerIcon as PhTimerIcon,
  TrashIcon as PhTrashIcon,
  TrayIcon,
  UserIcon as PhUserIcon,
  XIcon,
} from "@phosphor-icons/react";
import logoUrl from "../../src-tauri/icons/32x32.png";

type P = JSX.SVGAttributes<SVGSVGElement>;

function icon(Icon: PhosphorIcon, defaultWeight: "regular" | "bold" | "fill" = "regular") {
  return (props: P) => {
    const {
      width,
      height,
      class: className,
      "stroke-width": strokeWidth,
      ...rest
    } = props;
    const numericStroke = Number(strokeWidth ?? 0);
    return (
      <Icon
        size={Number(width ?? height ?? 18)}
        weight={numericStroke >= 2.5 ? "bold" : defaultWeight}
        className={className as string | undefined}
        {...(rest as Record<string, unknown>)}
      />
    );
  };
}

export const InboxIcon = icon(TrayIcon);
export const HourglassIcon = icon(HourglassMediumIcon);
export const UserIcon = icon(PhUserIcon);
export const TodayIcon = icon(CalendarBlankIcon);
export const UpcomingIcon = icon(CalendarDotsIcon);
export const LabelIcon = icon(TagIcon);
export const PlusIcon = icon(PhPlusIcon);
export const CheckIcon = icon(PhCheckIcon);
export const TrashIcon = icon(PhTrashIcon);
export const FlagIcon = icon(PhFlagIcon);
export const BellIcon = icon(PhBellIcon);
export const CalendarIcon = icon(PhCalendarIcon);
export const CloseIcon = icon(XIcon);
export const NoteIcon = icon(NotePencilIcon);
export const JournalIcon = icon(PhNotebookIcon);
export const EditIcon = icon(PencilSimpleIcon);
export const SunIcon = icon(PhSunIcon);
export const MoonIcon = icon(PhMoonIcon);
export const ChevronLeftIcon = icon(CaretLeftIcon);
export const ChevronRightIcon = icon(CaretRightIcon);
export const PinIcon = icon(PushPinIcon);
export const CheckCircleIcon = icon(PhCheckCircleIcon);
export const GripIcon = icon(DotsSixVerticalIcon, "bold");
export const SearchIcon = icon(MagnifyingGlassIcon);
export const SettingsIcon = icon(GearSixIcon);
export const RepeatIcon = icon(PhRepeatIcon);
export const ExpandIcon = icon(ArrowsOutIcon);
export const TimerIcon = icon(PhTimerIcon);
export const PlayIcon = icon(PhPlayIcon, "fill");
export const PauseIcon = icon(PhPauseIcon, "fill");
export const StopIcon = icon(PhStopIcon, "fill");
export const SkipIcon = icon(SkipForwardIcon, "fill");
export const RotateIcon = icon(ArrowCounterClockwiseIcon);
export const PowerIcon = icon(PhPowerIcon);
export const BoltIcon = icon(LightningIcon);
export const EyeIcon = icon(PhEyeIcon);
export const EyeOffIcon = icon(EyeSlashIcon);
export const ExternalLinkIcon = icon(ArrowSquareOutIcon);
export const GitHubIcon = icon(GithubLogoIcon);
export const WebsiteIcon = icon(GlobeSimpleIcon);
export const MenuIcon = icon(PhListIcon);

/** The original Todofy app icon, reused as the product mark. */
export const Logo = ({ size = 28 }: { size?: number }) => (
  <img src={logoUrl} width={size} height={size} alt="" class="block rounded-[7px]" />
);

/** Google's multi-color "G" mark for the OAuth sign-in button. */
export const GoogleIcon = ({ width, height }: P) => {
  const size = Number(width ?? height ?? 18);
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
};
