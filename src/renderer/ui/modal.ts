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
    '    <span class="cy-modal__icon" id="cy-modal-icon">📌</span>',
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
  iconEl.innerHTML = options.icon || (options.isAlert ? "ℹ️" : "📌");
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
      icon: "❓",
    });
  }
  return showModal({
    title: "Confirmation",
    confirmText: "Confirm",
    cancelText: "Cancel",
    icon: "❓",
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
      icon: "ℹ️",
    });
    return;
  }
  await showModal({
    title: "Notice",
    confirmText: "OK",
    isAlert: true,
    icon: "ℹ️",
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

  iconEl.innerHTML = options.icon || "✏️";
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
