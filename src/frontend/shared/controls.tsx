import {
  Children,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type SelectHTMLAttributes,
  type DialogHTMLAttributes,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

/** Native browser dialog behavior is an effect; content and visibility belong to React. */
export function Dialog({
  open,
  onDismiss,
  children,
  ...props
}: Omit<DialogHTMLAttributes<HTMLDialogElement>, "open"> & {
  open: boolean;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const programmaticClose = useRef(false);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    else if (!open && node.open) {
      programmaticClose.current = true;
      node.close();
    }
  }, [open]);
  useEffect(
    () => () => {
      if (ref.current?.open) ref.current.close();
    },
    [],
  );
  return (
    <dialog
      {...props}
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      onClose={() => {
        if (programmaticClose.current) {
          programmaticClose.current = false;
          return;
        }
        if (open) onDismiss();
      }}
    >
      {children}
    </dialog>
  );
}
type SelectOption = { value: string; label: string; disabled: boolean };
export function Select({
  id,
  children,
  value,
  onValue,
  label,
  required,
  disabled,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> & {
  id: string;
  value: string;
  onValue: (value: string) => void;
  label: string;
}) {
  const collect = (children: ReactNode): SelectOption[] =>
    Children.toArray(children).flatMap((child) => {
      if (
        !isValidElement<{
          value?: string | number;
          children?: ReactNode;
          disabled?: boolean;
        }>(child) ||
        (child.type !== "option" && typeof child.type === "string")
      )
        return [];
      if (child.type !== "option") return collect(child.props.children);
      const text = Children.toArray(child.props.children).join("");
      return [
        {
          value: String(child.props.value ?? text),
          label: text,
          disabled:
            !!child.props.disabled ||
            (!!required && String(child.props.value ?? text) === ""),
        },
      ];
    });
  const options = collect(children);
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(-1),
    [position, setPosition] = useState<CSSProperties>({}),
    trigger = useRef<HTMLButtonElement>(null),
    list = useRef<HTMLDivElement>(null),
    typed = useRef(""),
    timer = useRef<number | undefined>(undefined);
  const selected = options.find((option) => option.value === value),
    close = () => setOpen(false);
  const place = () => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const v = window.visualViewport,
      top = v?.offsetTop ?? 0,
      left = v?.offsetLeft ?? 0,
      height = v?.height ?? innerHeight,
      width = v?.width ?? innerWidth,
      below = top + height - r.bottom - 20,
      above = r.top - top - 20,
      up = below < 200 && above > below,
      maxHeight = Math.max(44, Math.min(288, up ? above : below));
    setPosition({
      width: Math.min(r.width, width - 24),
      maxHeight,
      left: Math.max(left + 12, Math.min(r.left, left + width - r.width - 12)),
      top: up ? Math.max(top + 12, r.top - 8 - maxHeight) : r.bottom + 8,
    });
  };
  useLayoutEffect(() => {
    if (!open) return;
    place();
    const n = list.current;
    if (n && typeof n.showPopover === "function" && !n.matches(":popover-open"))
      n.showPopover();
    return () => {
      if (n?.matches(":popover-open")) n.hidePopover();
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
        const node = event.target as Node;
        if (!trigger.current?.contains(node) && !list.current?.contains(node))
          close();
      },
      changed = (event: Event) => {
        if ((event as CustomEvent).detail !== id) close();
      };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("gp-select-open", changed);
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("gp-select-open", changed);
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
    };
  }, [open, id]);
  useEffect(() => {
    if (disabled) close();
  }, [disabled]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (open && active >= 0)
      list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  const show = () => {
    if (disabled) return;
    document.dispatchEvent(new CustomEvent("gp-select-open", { detail: id }));
    setActive(
      Math.max(
        0,
        options.findIndex(
          (option) => option.value === value && !option.disabled,
        ),
      ),
    );
    setOpen(true);
  };
  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onValue(option.value);
    close();
    trigger.current?.focus();
  };
  return (
    <>
      <select
        {...props}
        id={id}
        required={required}
        disabled={disabled}
        value={value}
        onChange={(event) => onValue(event.target.value)}
        hidden
        tabIndex={-1}
        onInvalid={(event) => {
          event.preventDefault();
          trigger.current?.focus();
        }}
      >
        {children}
      </select>
      <div className="select-control">
        <button
          ref={trigger}
          type="button"
          id={id + "-trigger"}
          className={
            "select-trigger" + (required && !value ? " is-placeholder" : "")
          }
          role="combobox"
          aria-label={label}
          aria-haspopup="listbox"
          aria-controls={id + "-list"}
          aria-expanded={open}
          aria-required={required}
          aria-activedescendant={
            open && active >= 0 ? id + "-option-" + active : undefined
          }
          disabled={disabled}
          onClick={() => (open ? close() : show())}
          onKeyDown={(event) => {
            const available = options
              .map((option, index) => (!option.disabled ? index : -1))
              .filter((index) => index >= 0);
            if (!available.length) return;
            if (event.key === "Escape") {
              event.preventDefault();
              close();
              return;
            }
            if (event.key === "Tab") {
              close();
              return;
            }
            if (["Enter", " "].includes(event.key)) {
              event.preventDefault();
              if (open) choose(active);
              else show();
              return;
            }
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              if (!open) show();
              const at = available.indexOf(active);
              setActive(
                event.key === "Home"
                  ? available[0]
                  : event.key === "End"
                    ? available.at(-1)!
                    : available[
                        (at +
                          (event.key === "ArrowUp" ? -1 : 1) +
                          available.length) %
                          available.length
                      ],
              );
              return;
            }
            if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
              typed.current += event.key.toLowerCase();
              window.clearTimeout(timer.current);
              timer.current = window.setTimeout(
                () => (typed.current = ""),
                700,
              );
              const index = options.findIndex(
                (option) =>
                  !option.disabled &&
                  option.label.toLowerCase().startsWith(typed.current),
              );
              if (index >= 0) {
                if (!open) show();
                setActive(index);
              }
            }
          }}
        >
          <span id={id + "-value"}>{selected?.label ?? ""}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>
      {createPortal(
        <div
          ref={list}
          id={id + "-list"}
          className="select-menu"
          role="listbox"
          aria-label={label}
          hidden={!open}
          popover="manual"
          style={position}
        >
          {options.map((option, index) => (
            <div
              key={option.value + ":" + index}
              id={id + "-option-" + index}
              className={
                "select-option" + (active === index ? " is-active" : "")
              }
              role="option"
              aria-label={option.label}
              aria-selected={value === option.value && !option.disabled}
              aria-disabled={option.disabled}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              {option.label}
            </div>
          ))}
        </div>,
        trigger.current?.closest("dialog") ?? document.body,
      )}
    </>
  );
}
