/*
 * Mobile navigation: a hamburger button that opens a React Aria popover with
 * the nav links and the theme toggle. Shown only below the header's mobile
 * breakpoint (CSS controls visibility). Keyboard, focus, and dismiss behaviour
 * come from react-aria-components.
 */
import {
  DialogTrigger,
  Button,
  Popover,
  Dialog,
} from "react-aria-components";
import ThemeToggle from "./ThemeToggle.tsx";

const LINKS = [
  { title: "Docs", href: "/docs/" },
  { title: "Sharing", href: "/docs/sharing/" },
  { title: "Install", href: "/docs/install/" },
  { title: "GitHub", href: "https://github.com/mmurakaru/cueloop" },
];

export default function MobileMenu() {
  return (
    <DialogTrigger>
      <Button className="menu-btn" aria-label="Open menu">
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M3 6h14M3 10h14M3 14h14"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </Button>
      <Popover className="menu-popover" placement="bottom end" offset={12}>
        <Dialog className="menu-dialog" aria-label="Navigation">
          <nav className="menu-nav">
            {LINKS.map((link) => (
              <a key={link.href} href={link.href} className="menu-link">
                {link.title}
              </a>
            ))}
          </nav>
          <div className="menu-footer">
            <span className="menu-footer__label">Theme</span>
            <ThemeToggle />
          </div>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
