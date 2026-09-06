import { CheckIcon } from "./Icons";

interface CheckboxProps {
  checked: boolean;
  onChange?: () => void;
  /** Box side length in px; the check mark scales with it. */
  size?: number;
  /** Fill/border color when checked. Any CSS color or var. */
  color?: string;
  disabled?: boolean;
  title?: string;
  /** When false, renders a non-clickable visual box (e.g. inside a clickable row). */
  interactive?: boolean;
}

export function Checkbox({
  checked,
  onChange,
  size = 18,
  color = "var(--color-accent)",
  disabled,
  title,
  interactive = true,
}: CheckboxProps) {
  const radius = Math.max(4, Math.round(size / 3));
  const check = Math.round(size * 0.6);
  const style = {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: `${radius}px`,
    ...(checked ? { backgroundColor: color, borderColor: color } : {}),
  };
  const cls = `grid shrink-0 place-items-center border-2 transition-colors ${
    checked ? "text-white" : "border-[var(--color-border-strong)] text-transparent"
  } ${interactive ? "disabled:opacity-50" : "pointer-events-none"} ${
    interactive && !checked ? "hover:border-[var(--color-accent)]" : ""
  }`;
  const mark = checked ? (
    <CheckIcon width={check} height={check} stroke-width={3} />
  ) : null;

  if (!interactive) {
    return (
      <span class={cls} style={style} aria-hidden="true">
        {mark}
      </span>
    );
  }
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      onClick={onChange}
      class={cls}
      style={style}
    >
      {mark}
    </button>
  );
}
