/*
 * Mobile navigation as a bottom drawer (delta.dev pattern). React Aria has no
 * named Drawer, so it is built from ModalOverlay + Modal - which give focus
 * trapping, dismiss-on-outside, Escape, and the data-entering/data-exiting
 * hooks the CSS uses to slide the sheet up. Shown only below the header's
 * mobile breakpoint (CSS controls the trigger's visibility).
 */
import {
  DialogTrigger,
  Button,
  ModalOverlay,
  Modal,
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
      <ModalOverlay className="drawer-overlay" isDismissable>
        <Modal className="drawer">
          <Dialog className="drawer-dialog" aria-label="Navigation">
            {({ close }) => (
              <>
                <div className="drawer-grip" aria-hidden="true" />
                <nav className="drawer-nav">
                  {LINKS.map((link) => (
                    <a
                      key={link.href}
                      href={link.href}
                      className="drawer-link"
                      onClick={close}
                    >
                      {link.title}
                    </a>
                  ))}
                </nav>
                <div className="drawer-footer">
                  <span className="drawer-footer__label">Theme</span>
                  <ThemeToggle />
                </div>
              </>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}
