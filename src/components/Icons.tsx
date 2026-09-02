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
