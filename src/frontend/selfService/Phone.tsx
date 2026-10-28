import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/mobile";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Dialog } from "../shared/controls.tsx";
const names = new Intl.DisplayNames(["en"], { type: "region" }),
  countries = getCountries()
    .map((code) => ({
      code,
      name: names.of(code) ?? code,
      dial: "+" + getCountryCallingCode(code),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
export function Phone({
  country,
  value,
  onChange,
  onCountry,
  disabled = false,
}: {
  country: CountryCode;
  value: string;
  onChange: (value: string) => void;
  onCountry: (country: CountryCode) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [feedback, setFeedback] = useState(""),
    [bounds, setBounds] = useState<CSSProperties>({}),
    input = useRef<HTMLInputElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    search = useRef<HTMLInputElement>(null),
    selected = countries.find((v) => v.code === country)!;
  const close = () => {
      setOpen(false);
      trigger.current?.focus();
    },
    fit = () => {
      const v = visualViewport,
        width = v?.width ?? innerWidth,
        height = v?.height ?? innerHeight,
        left = v?.offsetLeft ?? 0,
        top = v?.offsetTop ?? 0,
        mobile = width <= 760,
        gutter = mobile ? 0 : 16,
        panelWidth = Math.max(
          0,
          Math.min(mobile ? width : 416, width - gutter * 2),
        ),
        panelHeight = Math.max(
          0,
          Math.min(mobile ? 576 : 544, height - (mobile ? 16 : 32)),
        );
      setBounds({
        inset: "auto",
        margin: 0,
        width: panelWidth,
        height: panelHeight,
        left: left + (width - panelWidth) / 2,
        top: top + (mobile ? height - panelHeight : (height - panelHeight) / 2),
      });
    };
  const validate = () => {
    const number =
        /^[+\d\s().-]+$/u.test(value) && value.length <= 30
          ? parsePhoneNumberFromString(value, {
              defaultCountry: country,
              extract: false,
            })
          : null,
      valid = !!number?.isValid() && number.country === country && !number.ext,
      message = valid
        ? ""
        : "Enter a valid mobile number for " + selected.name + ".";
    input.current?.setCustomValidity(message);
    setFeedback(message);
    return valid;
  };
  useLayoutEffect(() => {
    if (open) {
      fit();
      search.current?.focus({ preventScroll: true });
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", fit);
    visualViewport?.addEventListener("resize", fit);
    visualViewport?.addEventListener("scroll", fit);
    return () => {
      window.removeEventListener("resize", fit);
      visualViewport?.removeEventListener("resize", fit);
      visualViewport?.removeEventListener("scroll", fit);
    };
  }, [open]);
  useEffect(() => {
    if (value.trim()) validate();
  }, [country]);
  return (
    <>
      <div className="phone-field">
        <label className="mobile-label" htmlFor="visitor-mobile">
          Mobile <span className="required">*</span>
        </label>
        <div className="phone-control">
          <button
            ref={trigger}
            className="phone-country"
            type="button"
            aria-haspopup="dialog"
            aria-label={"Country code: " + selected.name + " " + selected.dial}
            disabled={disabled}
            onClick={() => {
              setQuery("");
              setOpen(true);
            }}
          >
            <img
              className="country-flag"
              src={"/assets/flags/" + country.toLowerCase() + ".svg"}
              alt=""
              width="24"
              height="18"
            />
            <span>{selected.dial}</span>
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <input
            ref={input}
            id="visitor-mobile"
            name="phone"
            type="tel"
            inputMode="tel"
            maxLength={30}
            autoComplete="tel-national"
            required
            value={value}
            disabled={disabled}
            aria-label={"Mobile number, " + selected.name}
            aria-describedby="visitor-mobile-feedback"
            aria-invalid={feedback ? "true" : undefined}
            onChange={(event) => {
              input.current?.setCustomValidity("");
              setFeedback("");
              onChange(event.target.value);
            }}
            onBlur={() => {
              if (value.trim()) validate();
            }}
          />
        </div>
        <p
          className="phone-feedback"
          id="visitor-mobile-feedback"
          aria-live="polite"
        >
          {feedback}
        </p>
      </div>
      <Dialog
        className="country-dialog"
        aria-labelledby="country-title"
        open={open}
        onDismiss={close}
        style={bounds}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const r = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < r.left ||
              event.clientX > r.right ||
              event.clientY < r.top ||
              event.clientY > r.bottom
            )
              close();
          }
        }}
        onKeyDown={(event) => {
          if (
            !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) ||
            (["Home", "End"].includes(event.key) &&
              event.target === search.current)
          )
            return;
          const buttons = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
              ".country-results button",
            ),
          ];
          if (!buttons.length) return;
          event.preventDefault();
          const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            ),
            next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : Math.max(
                      0,
                      Math.min(
                        buttons.length - 1,
                        index + (event.key === "ArrowDown" ? 1 : -1),
                      ),
                    );
          buttons[next].focus();
        }}
      >
        <div className="country-heading">
          <h2 id="country-title">Country code</h2>
          <button
            type="button"
            className="quiet"
            aria-label="Close country list"
            onClick={close}
          >
            ×
          </button>
        </div>
        <input
          ref={search}
          type="search"
          placeholder="Search country or code"
          aria-label="Search country or calling code"
          aria-controls="country-results"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div
          className="country-results"
          id="country-results"
          role="group"
          aria-label="Countries"
        >
          {countries
            .filter((row) =>
              (row.name + " " + row.code + " " + row.dial)
                .toLowerCase()
                .includes(query.trim().toLowerCase()),
            )
            .map((row) => (
              <button
                key={row.code}
                type="button"
                className="country-option"
                aria-pressed={row.code === country}
                onClick={() => {
                  onCountry(row.code);
                  close();
                }}
              >
                <img
                  className="country-flag"
                  src={"/assets/flags/" + row.code.toLowerCase() + ".svg"}
                  alt=""
                  width="24"
                  height="18"
                  loading="lazy"
                />
                <span>{row.name}</span>
                <span className="country-dial">{row.dial}</span>
              </button>
            ))}
        </div>
      </Dialog>
    </>
  );
}
