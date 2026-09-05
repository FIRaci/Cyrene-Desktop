// Raw payload and response types for Feishu event subscriptions.
// Reference Feishu official documentation:
//   - Event subscription overview: https://open.feishu.cn/document/server-docs/event-subscription-guide/overview
//   - Receive message v1: https://open.feishu.cn/document/server-docs/im-v1/message-events/receive
//
// Field naming adheres strictly to snake_case as required by Feishu server protocol.

/** Top-level envelope for Feishu event subscriptions. May be encrypted or plaintext. */
export interface FeishuEventEnvelope {
  /** "url_verification" | "event_callback" | "challenge" (legacy) */
  type?: string;
  /** Returned during challenge verification */
  challenge?: string;
  /** Encrypted field. Requires decryption with Encrypt Key when present. */
  encrypt?: string;
  /** Plaintext payload (present when unencrypted) */
  header?: FeishuEventHeader;
  event?: unknown;
}

/** Event header (v2 protocol) */
export interface FeishuEventHeader {
  event_id?: string;
  event_type?: string;
  app_id?: string;
  tenant_key?: string;
  create_time?: string;
  token?: string;
}

/** Decrypted envelope (v2) */
export interface FeishuDecryptedEnvelope {
  schema?: string;
  header?: FeishuEventHeader;
  event?: FeishuImMessageEvent | Record<string, unknown>;
}

/** im.message.receive_v1 event content */
export interface FeishuImMessageEvent {
  sender?: {
    sender_id?: { open_id?: string; user_id?: string; union_id?: string };
    sender_type?: string;
    tenant_key?: string;
  };
  message?: {
    message_id?: string;
    root_id?: string;
    parent_id?: string;
    chat_id?: string;
    chat_type?: "p2p" | "group" | "channel" | string;
    message_type?: "text" | "image" | "file" | "audio" | "video" | "post" | "interactive" | string;
    content?: string; // JSON string containing message content
    mentions?: Array<{ key: string; id: { open_id?: string; user_id?: string } }>;
  };
  timestamp?: string;
}

/** Decrypted text message content (message_type === "text") */
export interface FeishuTextContent {
  text?: string;
}

/** Decrypted image message content (message_type === "image") */
export interface FeishuImageContent {
  image_key?: string;
}

/** Decrypted file message content */
export interface FeishuFileContent {
  file_key?: string;
  file_name?: string;
}

/** Decrypted voice message content (message_type === "audio") */
export interface FeishuAudioContent {
  file_key?: string;
  duration?: number;
}

/** tenant_access_token response */
export interface FeishuTokenResponse {
  code: number;
  msg: string;
  tenant_access_token?: string;
  expire?: number; // seconds
}

/** Send message response */
export interface FeishuSendMessageResponse {
  code: number;
  msg: string;
  data?: {
    message_id?: string;
    chat_id?: string;
    create_time?: string;
  };
}

/** Feishu IM v1 message content union type */
export type FeishuOutboundContent =
  | { text: string }
  | { image_key: string }
  | { file_key: string; file_name?: string }
  | { file_key: string; duration?: number }
  | FeishuInteractiveCard;

export interface FeishuInteractiveCard {
  /** Feishu interactive card schema, typically 2.0 */
  schema?: string;
  header?: { title?: { tag?: string; content?: string }; template?: string };
  elements?: unknown[];
}