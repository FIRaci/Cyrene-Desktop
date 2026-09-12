import "./modal.css";

export interface ModalOptions {
  title?: string;
  message: string;
  icon?: string;
  confirmText?: string;
  cancelText?: string;
  isAlert?: boolean;
  danger?: boolean;
}

export interface PromptOptions {
  title?: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  icon?: string;
  confirmText?: string;
  cancelText?: string;
}

export const MODAL_ICONS = {
  confirm: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ec4899" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  danger: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>`,
  warning: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  info: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  prompt: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ec4899" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
  success: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  tag: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ec4899" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
  puzzle: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19.439 7.85c-.049-.955-.24-1.226-1.07-1.426-.983-.238-1.503-.97-1.295-1.956.236-1.121-.497-2.148-1.616-2.261-1.16-.118-2.193.639-2.316 1.776-.112 1.034-.784 1.574-1.782 1.488-.934-.08-1.205.109-1.406.938-.237.978-.976 1.492-1.96 1.282-1.122-.239-2.145.498-2.257 1.618-.118 1.16.638 2.193 1.777 2.316 1.033.111 1.573.784 1.487 1.782-.08.934.11 1.205.94 1.405.976.235 1.493.978 1.281 1.961-.239 1.122.498 2.145 1.618 2.257 1.16.118 2.193-.638 2.316-1.777.111-1.033.784-1.573 1.782-1.487.934.08 1.205-.11 1.405-.94.235-.976.978-1.493 1.961-1.281 1.122.239 2.145-.498 2.257-1.618.118-1.16-.638-2.193-1.777-2.316-1.033-.111-1.573-.784-1.487-1.782z"/></svg>`,
};

export function resolveModalIcon(icon?: string, isAlert?: boolean, danger?: boolean): string {
  if (icon && icon.includes("<svg")) {
    return icon;
  }
  if (!icon) {
    if (danger) return MODAL_ICONS.danger;
    if (isAlert) return MODAL_ICONS.info;
    return MODAL_ICONS.confirm;
  }
  const clean = icon.trim();
  if (clean === "🗑️" || clean === "trash" || clean === "delete" || danger) {
    return MODAL_ICONS.danger;
  }
  if (clean === "⚠️" || clean === "warning" || clean === "alert") {
    return MODAL_ICONS.warning;
  }
  if (clean === "ℹ️" || clean === "ⓘ" || clean === "info") {
    return MODAL_ICONS.info;
  }
  if (clean === "❓" || clean === "confirm" || clean === "help") {
    return MODAL_ICONS.confirm;
  }
  if (clean === "✏️" || clean === "edit" || clean === "prompt") {
    return MODAL_ICONS.prompt;
  }
  if (clean === "✅" || clean === "check" || clean === "success") {
    return MODAL_ICONS.success;
  }
  if (clean === "🏷️" || clean === "tag") {
    return MODAL_ICONS.tag;
  }
  if (clean === "🧩" || clean === "puzzle" || clean === "plugin") {
    return MODAL_ICONS.puzzle;
  }
  if (clean === "📌" || clean === "pin") {
    return MODAL_ICONS.info;
  }
  return MODAL_ICONS.info;
}

let overlay: HTMLElement | null = null;

function initOverlay(): HTMLElement {
  let existing = document.getElementById("cy-modal-overlay");
  if (existing) {
    overlay = existing;
    return overlay;
  }

  overlay = document.createElement("div");
  overlay.id = "cy-modal-overlay";
  overlay.className = "cy-modal-overlay is-hidden";
  overlay.innerHTML = [
    '<div class="cy-modal" role="alertdialog" aria-modal="true">',
    '  <div class="cy-modal__head">',
    '    <span class="cy-modal__icon" id="cy-modal-icon"></span>',
    '    <h3 class="cy-modal__title" id="cy-modal-title">Notice</h3>',
    '  </div>',
    '  <hr class="cy-modal__divider">',
    '  <p class="cy-modal__body" id="cy-modal-message">Do you want to continue?</p>',
    '  <input type="text" id="cy-modal-input" class="cy-modal__input is-hidden" autocomplete="off" spellcheck="false" />',
    '  <div class="cy-modal__actions">',
    '    <button type="button" class="ghost-btn" id="cy-modal-cancel">Cancel</button>',
    '    <button type="button" class="btn-primary" id="cy-modal-confirm">Confirm</button>',
    '  </div>',
    '</div>',
  ].join("\n");
  document.body.appendChild(overlay);
  return overlay;
}

export function showModal(options: ModalOptions): Promise<boolean> {
  const el = initOverlay();
  if (!el) return Promise.resolve(false);

  const iconEl = el.querySelector("#cy-modal-icon") as HTMLElement;
  const titleEl = el.querySelector("#cy-modal-title") as HTMLElement;
  const msgEl = el.querySelector("#cy-modal-message") as HTMLElement;
  const inputEl = el.querySelector("#cy-modal-input") as HTMLInputElement;
  const cancelBtn = el.querySelector("#cy-modal-cancel") as HTMLButtonElement;
  const confirmBtn = el.querySelector("#cy-modal-confirm") as HTMLButtonElement;

  inputEl.classList.add("is-hidden");
  iconEl.innerHTML = resolveModalIcon(options.icon, options.isAlert, options.danger);
  titleEl.textContent = options.title || (options.isAlert ? "Notice" : "Confirmation");
  msgEl.textContent = options.message;

  cancelBtn.textContent = options.cancelText || "Cancel";
  confirmBtn.textContent = options.confirmText || (options.isAlert ? "OK" : "Confirm");

  if (options.isAlert) {
    cancelBtn.style.display = "none";
  } else {
    cancelBtn.style.display = "";
  }

  if (options.danger) {
    confirmBtn.classList.add("btn-danger");
  } else {
    confirmBtn.classList.remove("btn-danger");
  }

  el.classList.remove("is-hidden");

  setTimeout(() => {
    confirmBtn.focus();
  }, 40);

  return new Promise((resolve) => {
    let closed = false;

    const cleanup = (result: boolean) => {
      if (closed) return;
      closed = true;
      el.classList.add("is-hidden");
      cancelBtn.removeEventListener("click", onCancel);
      confirmBtn.removeEventListener("click", onConfirm);
      el.removeEventListener("click", onBackdropClick);
      document.removeEventListener("keydown", onKeyDown, true);
      resolve(result);
    };

    const onCancel = (e?: Event) => {
      e?.preventDefault();
      cleanup(false);
    };

    const onConfirm = (e?: Event) => {
      e?.preventDefault();
      cleanup(true);
    };

    const onBackdropClick = (e: MouseEvent) => {
      if (e.target === el) {
        cleanup(false);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cleanup(false);
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        cleanup(true);
      }
    };

    cancelBtn.addEventListener("click", onCancel);
    confirmBtn.addEventListener("click", onConfirm);
    el.addEventListener("click", onBackdropClick);
    document.addEventListener("keydown", onKeyDown, true);
  });
}

export function showConfirm(optionsOrMessage: ModalOptions | string): Promise<boolean> {
  if (typeof optionsOrMessage === "string") {
    return showModal({
      title: "Confirmation",
      message: optionsOrMessage,
      confirmText: "Confirm",
      cancelText: "Cancel",
      icon: MODAL_ICONS.confirm,
    });
  }
  return showModal({
    title: "Confirmation",
    confirmText: "Confirm",
    cancelText: "Cancel",
    icon: optionsOrMessage.danger ? MODAL_ICONS.danger : MODAL_ICONS.confirm,
    ...optionsOrMessage,
  });
}

export async function showAlert(optionsOrMessage: ModalOptions | string): Promise<void> {
  if (typeof optionsOrMessage === "string") {
    await showModal({
      title: "Notice",
      message: optionsOrMessage,
      confirmText: "OK",
      isAlert: true,
      icon: MODAL_ICONS.info,
    });
    return;
  }
  await showModal({
    title: "Notice",
    confirmText: "OK",
    isAlert: true,
    icon: optionsOrMessage.danger ? MODAL_ICONS.warning : MODAL_ICONS.info,
    ...optionsOrMessage,
  });
}

export function showPrompt(optionsOrMessage: PromptOptions | string): Promise<string | null> {
  const options: PromptOptions = typeof optionsOrMessage === "string"
    ? { message: optionsOrMessage }
    : optionsOrMessage;

  const el = initOverlay();
  if (!el) return Promise.resolve(null);

  const iconEl = el.querySelector("#cy-modal-icon") as HTMLElement;
  const titleEl = el.querySelector("#cy-modal-title") as HTMLElement;
  const msgEl = el.querySelector("#cy-modal-message") as HTMLElement;
  const inputEl = el.querySelector("#cy-modal-input") as HTMLInputElement;
  const cancelBtn = el.querySelector("#cy-modal-cancel") as HTMLButtonElement;
  const confirmBtn = el.querySelector("#cy-modal-confirm") as HTMLButtonElement;

  inputEl.classList.remove("is-hidden");
  inputEl.value = options.defaultValue || "";
  inputEl.placeholder = options.placeholder || "";

  iconEl.innerHTML = resolveModalIcon(options.icon || MODAL_ICONS.prompt);
  titleEl.textContent = options.title || "Input";
  msgEl.textContent = options.message;

  cancelBtn.style.display = "";
  cancelBtn.textContent = options.cancelText || "Cancel";
  confirmBtn.textContent = options.confirmText || "Confirm";
  confirmBtn.classList.remove("btn-danger");

  el.classList.remove("is-hidden");

  setTimeout(() => {
    inputEl.focus();
    inputEl.select();
  }, 40);

  return new Promise((resolve) => {
    let closed = false;

    const cleanup = (result: string | null) => {
      if (closed) return;
      closed = true;
      el.classList.add("is-hidden");
      inputEl.classList.add("is-hidden");
      cancelBtn.removeEventListener("click", onCancel);
      confirmBtn.removeEventListener("click", onConfirm);
      el.removeEventListener("click", onBackdropClick);
      document.removeEventListener("keydown", onKeyDown, true);
      resolve(result);
    };

    const onCancel = (e?: Event) => {
      e?.preventDefault();
      cleanup(null);
    };

    const onConfirm = (e?: Event) => {
      e?.preventDefault();
      cleanup(inputEl.value);
    };

    const onBackdropClick = (e: MouseEvent) => {
      if (e.target === el) {
        cleanup(null);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cleanup(null);
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        cleanup(inputEl.value);
      }
    };

    cancelBtn.addEventListener("click", onCancel);
    confirmBtn.addEventListener("click", onConfirm);
    el.addEventListener("click", onBackdropClick);
    document.addEventListener("keydown", onKeyDown, true);
  });
}
