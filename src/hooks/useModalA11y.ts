import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Accessibility hook for modal dialogs:
 * - Closes on Escape key
 * - Traps Tab / Shift+Tab within the modal container
 * - Focuses the first focusable element on mount
 * - Restores focus to the previously-focused element on unmount
 */
export function useModalA11y(
  modalRef: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const previouslyFocused = useRef<Element | null>(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement;

    // Focus the first focusable element inside the modal
    const modal = modalRef.current;
    if (modal) {
      const first = modal.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      if (first) {
        first.focus();
      } else {
        // If no focusable child, focus the container itself
        modal.setAttribute("tabindex", "-1");
        modal.focus();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === "Tab" && modal) {
        const focusable = Array.from(
          modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    const savedRef = previouslyFocused.current;
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      // Restore focus to the element that was focused before the modal opened
      if (savedRef && savedRef instanceof HTMLElement) {
        savedRef.focus();
      }
    };
  }, [modalRef, onClose]);
}
