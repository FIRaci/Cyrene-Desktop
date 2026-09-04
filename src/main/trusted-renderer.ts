export interface TrustedFrameLike {
  readonly url: string;
}

export interface TrustedWebContentsLike {
  readonly id: number;
  readonly mainFrame: TrustedFrameLike;
  isDestroyed(): boolean;
}

export interface TrustedWindowLike {
  readonly webContents: TrustedWebContentsLike;
  isDestroyed(): boolean;
}

export interface TrustedIpcEventLike {
  readonly sender: TrustedWebContentsLike;
  readonly senderFrame: TrustedFrameLike | null;
}

function documentIdentity(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return url.href;
  } catch {
    return null;
  }
}

/** Fail-closed ownership check for privileged renderer IPC. */
export function isTrustedMainFrameSender(
  event: TrustedIpcEventLike,
  owner: TrustedWindowLike | null,
  expectedDocumentUrl: string,
): boolean {
  if (!owner || owner.isDestroyed() || owner.webContents.isDestroyed()) return false;
  if (event.sender !== owner.webContents) return false;
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
  if (event.senderFrame !== owner.webContents.mainFrame) return false;
  const actual = documentIdentity(event.senderFrame.url);
  const expected = documentIdentity(expectedDocumentUrl);
  return actual !== null && expected !== null && actual === expected;
}

export function assertTrustedMainFrameSender(
  event: TrustedIpcEventLike,
  owner: TrustedWindowLike | null,
  expectedDocumentUrl: string,
  errorCode: string,
): void {
  if (!isTrustedMainFrameSender(event, owner, expectedDocumentUrl)) throw new Error(errorCode);
}
