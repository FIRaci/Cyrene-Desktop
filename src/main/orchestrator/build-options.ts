// buildAgentRunOptions - Extract the AG-UI bridge's buildOptions closure into a pure function.
//
// Design principles:
//   - The function has no module-level state; all index.ts module-level symbols (runtimeState, stickerEmbeddingIndex, etc.)
//     are injected via the deps parameter.
//   - The function has no side effects (excluding console.warn); side effects (memory write / sticker broadcast) are handled
//     separately by onRunFinished, injected into the same deps.
//   - index.ts / dispatcher / scheduler share the same factory.
//   - Default style is hardcoded to '01_default.md', consistent with original behavior.
//
// Field dependency overview (per index.ts:3175-3281):
//   loadModelSettings / loadUserProfile / buildEnvironmentContext
//   buildSkillCatalog / skillRegistry / resolveSlashActivation
//   buildToneInjection / sceneEmbeddingIndex / getSceneEmbeddingProvider
//   buildSystemPrompt / logWorldbookInjection / CHAT_REQUEST_TIMEOUT_MS
//   normalizeChatMessages / buildAlwaysOnContext / ToolDefinition
//   scheduleMemoryWrite / inferRuntimeState / runtimeState / feelingToExpression
//   matchSticker / stickerEmbeddingIndex / getEmbeddingProvider / loadStickerSettings
//   broadcastRuntimeStateChanged / observeRuntimeState
//   IPC.AGUI_EVENT / chatWindow (used to push stickers)
//
// All of these are packed into BuildOptionsDeps. dispatcher injects the same deps in Phase 1.
import {
  resolveExecutionMode,
  type CyreneRunOptions,
  type CyreneRunResult,
} from "./cyrene-agent";
import type { ToolDefinition } from "./tool-registry";
import type { ChatMessage, OpenAIContentBlock } from "./vendors/types";
import type { AguiRunInput } from "../agui-bridge";
import { IPC } from "../../shared/ipc-channels";
import { isModelEndpointUsable } from "../../shared/model-endpoint";
import type { RelationshipChannel, RelationshipTurnInput } from "../relationship/relationship-log";
import { validateCaptionImagePath } from "../chat/image-caption";
import {
  buildConversationTimeContext,
  resolveChatContextTimezone,
  type ChatContextMessage,
} from "../chat-time-context";
import { perf } from "../perf-trace";
import { debugLog } from "../agent-log";
import { buildResponseContext } from "../cita/context-package";
import {
  STYLE_IDS,
  normalizeStyleId,
  type CustomStyleConfig,
  type StyleId,
} from "../../shared/style-sampling";
import type { ApprovedStyleSampling } from "./vendors/style-sampling";
import type {
  SocialAtom,
  SocialExtractionInput,
} from "../social-context/types";
import type { TrustedAskUserProfile } from "../../shared/ask-clarification";
import type { SkillRouteInfo } from "./task-router";
import { filterToolsBySearchBackend, type SearchBackend } from "./search-backend-filter";

/** Minimal injectable subset of index.ts module-level symbols.
 *  Types intentionally use loose signatures (unknown / arbitrary shape) because build-options is a pure consumer;
 *  actual calls from index.ts inject real strongly-typed functions. This prevents circular type dependencies. */
export interface BuildOptionsDeps {
  loadModelSettings: () => ModelSettingsLite;
  loadGeneralSettings: () => StyleSettingsLite;
  loadUserProfile: () => UserProfileLite;
  buildEnvironmentContext: (model: { provider: string; model: string }, profile: unknown) => string;
  buildSkillCatalog: (skills: ReadonlyArray<unknown>) => string;
  buildAutoInjectedSkillContext: (skills: ReadonlyArray<unknown>) => string;
  buildAutoInjectedSoulContext?: (skills: ReadonlyArray<unknown>) => string;
  skillRegistry: { getEnabled(): ReadonlyArray<unknown> };
  resolveSlashActivation: (messages: ReadonlyArray<{ role: string; content?: string }>) => string;
  buildToneInjection: (
    userText: string,
    messages: ReadonlyArray<{ role: string; content?: string }>,
    provider: unknown,
    index: unknown,
  ) => Promise<string>;
  sceneEmbeddingIndex: unknown;
  getSceneEmbeddingProvider: () => unknown;
  buildAlwaysOnContext: (
    userText: string,
    messages: ReadonlyArray<{ role: string; content?: string }>,
  ) => Promise<string>;
  buildRelationshipContext: () => Promise<string>;
  buildSystemPrompt: (styleFile: string) => string;
  /** Phase 1: Tool-phase system prompt. Contains only tool scheduling rules + auto-generated tool catalog. */
  buildToolSystemPrompt: (enabledTools: ReadonlyArray<unknown>) => string;
  /** Phase 1: Base system prompt used in the Soul phase. Tool results are dynamically appended before Soul phase execution in the FC loop. */
  buildSoulSystemBasePrompt: (styleFile: string) => string;
  /** Style Markdown already resolved by the main side; build-options only handles boundary injection. */
  readStylePrompt: (styleId: StyleId) => string;
  /** Soul sampling parameters resolved by provider/model/reasoning/customStyle. */
  resolveSoulSampling: (input: {
    styleId: StyleId;
    settings: ModelSettingsLite;
    customStyle: CustomStyleConfig;
  }) => ApprovedStyleSampling;
  /** Phase 1: Injected toolRegistry (used by buildToolSystemPrompt to auto-generate catalog). */
  toolRegistry: { getEnabled(): ReadonlyArray<unknown> };
  logWorldbookInjection: (alwaysOnContext: string, systemContent: string) => void;
  normalizeChatMessages: (raw: ReadonlyArray<unknown>) => ChatMessage[];
  chatRequestTimeoutMs: number;
  captionImageForFallback?: (filePath: string) => Promise<{ ok: boolean; caption?: string; error?: string }>;
  loadActionGateSystemPrompt: () => string;
  loadNativeFcSystemPrompt: () => string;
  loadAskSystemPrompt: () => string;
  loadAskPersonaPrompt: () => string;
  loadAskQuotesPrompt: () => string;
  prepareCitaTurn?: (input: {
    conversationId: string;
    turnId: string;
    originalQuery: string;
    recentDialogue: Array<{ role: "user" | "assistant"; text: string }>;
  }) => Promise<{
    contextBlock: string;
    contextPackage?: {
      originalQuery: string;
      contextualizedQuery: string;
      resolvedReferences: Array<{ surface: string; targetRef: string }>;
      focusedContexts?: Array<{ contextRef: string }>;
      supportingContexts?: Array<{ contextRef: string }>;
    };
  }>;
  buildChatSocialContext?: (input: {
    conversationId: string;
    query: string;
  }) => Promise<{
    contextBlock: string;
    retrievedAtoms: SocialAtom[];
  }>;
}

/** deps needed for onRunFinished side-effects (partially overlapping with BuildOptionsDeps) */
export interface OnRunFinishedDeps {
  loadModelSettings: () => ModelSettingsLite;
  scheduleMemoryWrite: (userText: string, reply: string) => void;
  scheduleSocialAtomExtraction?: (input: SocialExtractionInput) => void;
  inferRuntimeState: (userText: string, reply: string, flag: boolean) => { status: string };
  inferFeelingState?: (text: string) => string;
  runtimeState: {
    status: string;
    expression: number;
    updatedAt: number;
    feeling?: string;
  };
  feelingToExpression: Record<string, number>;
  setRuntimeState: (next: { status?: string; expression?: number; updatedAt?: number; feeling?: string }) => void;
  stickerEmbeddingIndex: unknown;
  getStickerEmbeddingIndex?: () => unknown;
  getEmbeddingProvider: () => unknown;
  matchSticker: (
    text: string,
    provider: unknown,
    index: unknown,
    threshold: number,
  ) => Promise<{ id: string } | null | undefined>;
  loadStickerSettings: () => Record<string, boolean>;
  broadcastRuntimeStateChanged: () => void;
  observeRuntimeState: (
    settings: ModelSettingsLite,
    history: ReadonlyArray<unknown>,
    userText: string,
    reply: string,
  ) => Promise<void>;
  recordRelationshipTurn: (input: RelationshipTurnInput) => Promise<unknown> | unknown;
  getChatWindow: () => { webContents: { isDestroyed(): boolean; send: (channel: string, ...args: unknown[]) => void }; isDestroyed(): boolean } | null;
}

export interface ModelSettingsLite {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  explicitTransport?: "openai" | "anthropic" | "auto";
  /** Top-level reasoning mirror (from perProvider[currentProvider].reasoning). Read directly by adapter. */
  reasoning?: import("../../shared/reasoning").ReasoningPreference;
  runtimeSync?: string;
  stickerEnabled?: boolean;
  stickerSimilarityThreshold?: number;
}

export interface StyleSettingsLite {
  currentStyleId?: unknown;
  customStyle?: unknown;
  chatSocialContextEnabled?: unknown;
}

export interface UserProfileLite {
  nickname?: string;
  callPreference?: string;
  birthday?: string;
  defaultCity?: string;
  timezone?: string;
  gender?: string;
}

export function buildChannelSystem(channel?: RelationshipChannel): string {
  if (channel === "wechat") {
    return [
      "[Channel response style]",
      "You are replying to the user through WeChat.",
      "Write like a natural WeChat conversation: short, conversational, and responsive.",
      "Avoid long explanations and do not mention the desktop app, tool calls, or the system.",
      "For complex tasks, acknowledge briefly and then work quietly.",
    ].join("\n");
  }
  if (channel === "feishu") {
    return [
      "[Channel response style]",
      "You are replying to the user through Feishu.",
      "Keep Cyrene's voice while fitting a work context: clear, time-efficient, and conclusion-first.",
      "Use short steps when helpful; avoid excessive cuteness or long emotional replies.",
    ].join("\n");
  }
  return "";
}

function contentToText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block): block is { type: "text"; text: string } => block?.type === "text")
      .map((block) => block.text)
      .join("\n");
  }
  return "";
}

function stripTurnModelContextForSideEffects(text: string): string {
  const markers = [
    "\n\n[Files for this turn]",
    "\n\n[Document content]",
    "\n\n[Image observations]",
    "\n\n[Image attachments]",
    "[Files for this turn]",
    "[Document content]",
    "[Image observations]",
    "[Image attachments]",
    // Legacy stored turns can still contain the retired localized section
    // markers. Keep them as input-only aliases so document payloads never leak
    // into memory or sticker side effects after upgrading.
    "\n\n\u3010\u672c\u8f6e\u6587\u4ef6\u3011",
    "\n\n\u3010\u6587\u6863\u5185\u5bb9\u3011",
    "\n\n\u3010\u56fe\u7247\u89c6\u89c9\u4fe1\u606f\u3011",
    "\n\n\u3010\u56fe\u7247\u9644\u4ef6\u3011",
    "\u3010\u672c\u8f6e\u6587\u4ef6\u3011",
    "\u3010\u6587\u6863\u5185\u5bb9\u3011",
    "\u3010\u56fe\u7247\u89c6\u89c9\u4fe1\u606f\u3011",
    "\u3010\u56fe\u7247\u9644\u4ef6\u3011",
  ];
  const cut = markers
    .map((marker) => text.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  return (cut === undefined ? text : text.slice(0, cut)).trim();
}

function withDirectImageAttachments(messages: ChatMessage[], input: AguiRunInput): ChatMessage[] {
  const images = input.imageAttachments?.filter((image) =>
    typeof image?.filePath === "string" && typeof image?.name === "string",
  ) ?? [];
  if (images.length === 0) return messages;

  const latestUserIndex = messages.map((message) => message.role).lastIndexOf("user");
  if (latestUserIndex < 0) return messages;

  const current = messages[latestUserIndex];
  const blocks: OpenAIContentBlock[] = [];
  const text = contentToText(current.content);
  blocks.push({ type: "text", text });

  for (const image of images) {
    const validated = validateCaptionImagePath(image.filePath);
    if (!validated.ok) {
      blocks.push({
        type: "text",
        text: `Image ${image.name} could not be read: ${validated.error}. State honestly that the image is unavailable and do not invent its contents.`,
      });
      continue;
    }
    blocks.push({
      type: "image_url",
      image_url: { url: `data:${validated.mime};base64,${validated.buffer.toString("base64")}` },
    });
  }

  const next = messages.slice();
  next[latestUserIndex] = { ...current, content: blocks };
  return next;
}

function buildImageCaptionFallbackMessages(
  systemContent: string,
  messages: ChatMessage[],
  input: AguiRunInput,
  deps: BuildOptionsDeps,
): (() => Promise<ChatMessage[]>) | undefined {
  const images = input.imageAttachments?.filter((image) =>
    typeof image?.filePath === "string" && typeof image?.name === "string",
  ) ?? [];
  if (images.length === 0 || !deps.captionImageForFallback) return undefined;

  return async () => {
    const fallbackMessages = messages.map((message) => ({ ...message }));
    const latestUserIndex = fallbackMessages.map((message) => message.role).lastIndexOf("user");
    if (latestUserIndex < 0) return [{ role: "system", content: systemContent }, ...fallbackMessages];

    const current = fallbackMessages[latestUserIndex];
    const text = contentToText(current.content);
    const imageLines: string[] = [];
    for (const image of images) {
      const result = await deps.captionImageForFallback!(image.filePath);
      if (result.ok && result.caption) {
        imageLines.push(`- ${image.name}: ${result.caption}`);
      } else {
        imageLines.push(`- ${image.name}: image analysis failed: ${result.error || "unknown analysis error"}. State honestly that the image is unavailable.`);
      }
    }

    const imageContext = "[Image observations]\nThe vision model produced the following observations for this turn. Treat successful observations as visible image content. If analysis failed, do not invent details.\n" + imageLines.join("\n");
    fallbackMessages[latestUserIndex] = {
      ...current,
      content: text ? `${text}\n\n${imageContext}` : imageContext,
    };
    return [{ role: "system", content: systemContent }, ...fallbackMessages];
  };
}

function isStyleId(value: unknown): value is StyleId {
  return typeof value === "string" && (STYLE_IDS as readonly string[]).includes(value);
}

function styleIdFromLegacyFile(value: unknown): StyleId | undefined {
  if (typeof value !== "string") return undefined;
  const legacy: Record<string, StyleId> = {
    "01_default.md": "default",
    "02_lively.md": "lively",
    "03_healing.md": "healing",
    "04_focused.md": "focused",
    "05_sweet.md": "sweet",
  };
  return legacy[value];
}

function resolveRunStyleId(input: AguiRunInput, saved: StyleSettingsLite): StyleId {
  if (isStyleId(input.styleId)) return input.styleId;
  const legacyStyleId = styleIdFromLegacyFile(input.style);
  if (legacyStyleId) return legacyStyleId;
  if (isStyleId(saved.currentStyleId)) return saved.currentStyleId;
  return normalizeStyleId(undefined);
}

function buildStylePromptBlock(markdown: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) return "";
  return [
    "[Expression style]",
    "The following content controls wording, sentence structure, tone, and information density only.",
    "It must not modify identity, factual memory, tool rules, safety constraints, or mandatory behavior.",
    "",
    trimmed,
  ].join("\n");
}

/**
 * Construct options required by CyreneAgent.runWithEvents + extract latestUserText.
 * Completely identical in behavior to the original index.ts AG-UI bridge buildOptions.
 */
export async function buildAgentRunOptions(
  input: AguiRunInput,
  deps: BuildOptionsDeps,
): Promise<{ options: CyreneRunOptions; latestUserText: string }> {
  const settings = deps.loadModelSettings();
  const styleSettings = deps.loadGeneralSettings();
  if (!settings.baseUrl.trim()) {
    throw new Error("No model endpoint is configured. Open Settings and enter a Base URL.");
  }
  if (!settings.model.trim()) {
    throw new Error("No model is configured. Open Settings and enter a Model ID.");
  }
  if (!isModelEndpointUsable(settings)) {
    throw new Error("No API key is configured for the selected cloud provider. Open Settings and save its API configuration.");
  }
  const messages = deps.normalizeChatMessages(input.messages);
  if (messages.length === 0) {
    throw new Error("There is no chat content to send.");
  }
  // slim view for downstream helpers that only need { role, content }
  const slimMessages = messages as unknown as Array<{ role: string; content?: string }>;
  const latestUserText = contentToText(messages.filter((m) => m.role === "user").at(-1)?.content) ?? "";
  const executionMode = resolveExecutionMode(
    input.executionMode ?? ((input.style || "").startsWith("talk") ? "chat" : "work"),
  );
  const isChatMode = executionMode === "chat";
  const conversationId = input.sessionId || "default";
  const socialContextEnabled = isChatMode
    && styleSettings.chatSocialContextEnabled === true
    && Boolean(deps.buildChatSocialContext);
  const messagesForSoul = socialContextEnabled ? messages.slice(-12) : messages;
  const skillActivation = deps.resolveSlashActivation(slimMessages);
  const profile = deps.loadUserProfile();
  const { cleanMessages: cleanLlm, timestampedMessages: llmMessages, timeContext: conversationTimeContext } = buildConversationTimeContext(
    messagesForSoul as unknown as ChatContextMessage[],
    resolveChatContextTimezone(profile.timezone),
  );
  const slimLlmMessages = llmMessages as Array<{ role: string; content?: string }>;

  let alwaysOnContext = "";
  try {
    alwaysOnContext = await perf.track("build_always_on_context", () => deps.buildAlwaysOnContext(latestUserText, slimMessages));
  } catch (err) {
    console.warn("[Cyrene] always-on context build failed:", err);
  }

  let relationshipContext = "";
  try {
    relationshipContext = await perf.track("build_relationship_context", () => deps.buildRelationshipContext());
  } catch (err) {
    console.warn("[Cyrene] relationship context build failed:", err);
  }

  let environmentContext = "";
  const envTimer = perf.begin("build_environment_context");
  try {
    environmentContext = deps.buildEnvironmentContext(
      { provider: settings.provider, model: settings.model },
      {
        nickname: profile.nickname,
        callPreference: profile.callPreference,
        birthday: profile.birthday,
        defaultCity: profile.defaultCity,
        timezone: profile.timezone,
        gender: profile.gender,
      },
    );
  } catch (err) {
    console.warn("[Cyrene] environment context build failed:", err);
  }
  envTimer.end();

  const enabledSkills = deps.skillRegistry.getEnabled();
  const skillCatalog = deps.buildSkillCatalog(enabledSkills);
  const autoInjectedSkillContext = deps.buildAutoInjectedSkillContext(enabledSkills);
  const autoInjectedSoulContext = deps.buildAutoInjectedSoulContext?.(enabledSkills) ?? "";

  // Task Router available Skill list (used by Router for direct/plan determination and Skill loading)
  const availableSkills: SkillRouteInfo[] = (enabledSkills as Array<Record<string, unknown>>).map((s) => ({
    id: String(s.id ?? ""),
    description: String(s.description ?? ""),
    ...((s.manifest as Record<string, unknown>)?.defaultExecutionMode
      ? { defaultExecutionMode: (s.manifest as Record<string, unknown>).defaultExecutionMode as "direct" | "plan" }
      : {}),
  })).filter((s) => s.id);
  const channelSystem = buildChannelSystem(input.channel);

  let chatSocialContextBlock = "";
  let retrievedSocialAtoms: SocialAtom[] = [];
  if (socialContextEnabled) {
    try {
      const built = await perf.track("build_chat_social_context", () => (
        deps.buildChatSocialContext!({
          conversationId,
          query: latestUserText,
        })
      ));
      chatSocialContextBlock = built.contextBlock;
      retrievedSocialAtoms = built.retrievedAtoms.slice(0, 5);
    } catch (err) {
      console.warn("[Cyrene] chat social context build failed:", err);
    }
  }

  let citaContextBlock = "";
  let contextualizedQuery = latestUserText;
  let responseContext = "";
  let trustedRefs: string[] = [];
  if (!isChatMode && deps.prepareCitaTurn) {
    try {
      const recentDialogue = messages
        .filter((message): message is ChatMessage & { role: "user" | "assistant" } => (
          message.role === "user" || message.role === "assistant"
        ))
        .slice(-12)
        .map((message) => ({ role: message.role, text: contentToText(message.content) }));
      const prepared = await perf.track("cita_prepare_turn", () => deps.prepareCitaTurn!({
        conversationId,
        turnId: `${conversationId}:${messages.length}`,
        originalQuery: latestUserText,
        recentDialogue,
      }));
      citaContextBlock = prepared.contextBlock;
      contextualizedQuery = prepared.contextPackage?.contextualizedQuery ?? latestUserText;
      if (prepared.contextPackage) {
        trustedRefs = [...new Set([
          ...prepared.contextPackage.resolvedReferences.map((reference) => reference.targetRef),
          ...(prepared.contextPackage.focusedContexts ?? []).map((context) => context.contextRef),
          ...(prepared.contextPackage.supportingContexts ?? []).map((context) => context.contextRef),
        ])];
        responseContext = buildResponseContext(
          prepared.contextPackage.contextualizedQuery,
          prepared.contextPackage.resolvedReferences,
        );
      }
      debugLog(
        `[CITA/Trace] injection conversation=${conversationId} tool=${citaContextBlock.length > 0} soul=${citaContextBlock.length > 0} blockChars=${citaContextBlock.length}`,
      );
    } catch {
      console.warn(`[CITA] injection conversation=${conversationId} tool=false soul=false reason=prepare_failed`);
    }
  }

  let toneInjection = "";
  if (deps.sceneEmbeddingIndex) {
    try {
      toneInjection = await perf.track("build_tone_injection", () => deps.buildToneInjection(
        latestUserText,
        slimLlmMessages,
        deps.getSceneEmbeddingProvider(),
        deps.sceneEmbeddingIndex,
      ));
    } catch (err) {
      console.warn("[Cyrene] tone injection failed:", err);
    }
  }

  let attachmentContext = "";
  const atts = input.attachments;
  if (atts && atts.length > 0) {
    const parts = atts.map((a) => `--- ${a.name} ---\n${a.text}`);
    attachmentContext = `\n\n[Attachment content for this turn]\n${parts.join("\n\n")}`;
  }

  const styleId = resolveRunStyleId(input, styleSettings);
  const stylePromptBlock = buildStylePromptBlock(deps.readStylePrompt(styleId));
  const soulSampling = deps.resolveSoulSampling({
    styleId,
    settings,
    customStyle: styleSettings.customStyle as CustomStyleConfig,
  });
  // Execution mode determines base system only; expressive style is always separately injected into Soul.
  const basePromptMode = isChatMode ? "chat" : "work";
  const enabledTools = deps.toolRegistry.getEnabled();

  // Search backend mutually exclusive filter: expose only search tools corresponding to current backend per turn
  const generalSettings = deps.loadGeneralSettings();
  const activeSearchBackend = ((generalSettings as Record<string, unknown>).searchEngine as string ?? "off") as SearchBackend;
  const filteredBySearch = isChatMode ? [] : filterToolsBySearchBackend(
    enabledTools as unknown as Array<{ id: string }>,
    activeSearchBackend,
  );

  const runTools = filteredBySearch as unknown as typeof enabledTools;
  const searchToolIds = filteredBySearch
    .filter((t) => t.id === "web_search" || t.id.startsWith("minimax-web-search-"))
    .map((t) => t.id);
  console.log(`[Cyrene] search backend=${activeSearchBackend} exposed search tools=[${searchToolIds.join(", ") || "none"}]`);
  // Phase 1: Keep legacy systemContent for compatibility (no longer used, retained for logger diagnostics).
  // Concurrently adds toolSystemContent / soulSystemBaseContent suites.
  const systemContent =
    (environmentContext ? environmentContext + "\n\n" : "") +
    (conversationTimeContext ? conversationTimeContext + "\n\n---\n\n" : "") +
    (channelSystem ? channelSystem + "\n\n" : "") +
    deps.buildSystemPrompt(basePromptMode) +
    (skillCatalog ? "\n\n---\n\n" + skillCatalog : "") +
    (autoInjectedSkillContext ? "\n\n---\n\n" + autoInjectedSkillContext : "") +
    skillActivation +
    toneInjection +
    (alwaysOnContext ? "\n\n" + alwaysOnContext + "\n\n" : "") +
    (relationshipContext ? "\n\n" + relationshipContext + "\n\n" : "") +
    attachmentContext;

  // Tool phase: tool rules + runtime tool catalog + available Skill routing manifest.
  const toolSystemContent = deps.buildToolSystemPrompt(runTools)
    + (skillCatalog ? "\n\n---\n\n" + skillCatalog : "")
    + (autoInjectedSkillContext ? "\n\n---\n\n" + autoInjectedSkillContext : "")
    + (citaContextBlock ? "\n\n" + citaContextBlock : "");

  // Soul phase base system: persona + environment/memory/relationship/attachments/channel (needed for "expression").
  // FC loop appends common ToolExecutionContext during Soul phase and preserves role:tool protocol messages.
  const soulSystemWithoutCita =
    (environmentContext ? environmentContext + "\n\n" : "") +
    (conversationTimeContext ? conversationTimeContext + "\n\n---\n\n" : "") +
    (channelSystem ? channelSystem + "\n\n" : "") +
    deps.buildSoulSystemBasePrompt(basePromptMode) +
    (chatSocialContextBlock ? "\n\n---\n\n" + chatSocialContextBlock : "") +
    (stylePromptBlock ? "\n\n---\n\n" + stylePromptBlock : "") +
    (autoInjectedSoulContext ? "\n\n---\n\n" + autoInjectedSoulContext : "") +
    skillActivation +
    toneInjection +
    (alwaysOnContext ? "\n\n" + alwaysOnContext + "\n\n" : "") +
    (relationshipContext ? "\n\n" + relationshipContext + "\n\n" : "") +
    attachmentContext;
  const soulSystemBaseContent = soulSystemWithoutCita;

  const nativeFcSystemContent = deps.loadNativeFcSystemPrompt();
  const actionGateSystemPrompt = deps.loadActionGateSystemPrompt();
  const askSystemContent = [
    deps.loadAskSystemPrompt(),
    deps.loadAskPersonaPrompt(),
    deps.loadAskQuotesPrompt(),
  ].filter(Boolean).join("\n\n");
  const profileGender: NonNullable<TrustedAskUserProfile["gender"]> = profile.gender === "male"
    || profile.gender === "female"
    || profile.gender === "nonbinary"
    || profile.gender === "secret"
    ? profile.gender
    : "unknown";
  const trustedAskUserProfile = {
    ...(profile.callPreference?.trim() ? { callPreference: profile.callPreference.trim() } : {}),
    ...(profile.nickname?.trim() ? { nickname: profile.nickname.trim() } : {}),
    gender: profileGender,
  };

  deps.logWorldbookInjection(alwaysOnContext, systemContent);

  // Phase 1: original messages no longer carry system. FC loop dynamically injects per phase.
  const fcMessages: ChatMessage[] = withDirectImageAttachments(llmMessages as unknown as ChatMessage[], input);
  const cleanFcMessages: ChatMessage[] = withDirectImageAttachments(cleanLlm as unknown as ChatMessage[], input);
  const imageCaptionFallback = buildImageCaptionFallbackMessages(
    isChatMode
      ? soulSystemWithoutCita
      : toolSystemContent + "\n\n---\n\n" + soulSystemWithoutCita,
    llmMessages as unknown as ChatMessage[],
    input,
    deps,
  );

  return {
    options: {
      settings: {
        provider: settings.provider,
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey: settings.apiKey,
        explicitTransport: settings.explicitTransport,
        reasoning: settings.reasoning,
      },
      messages: fcMessages,
      cleanMessages: cleanFcMessages,
      conversationId,
      executionMode,
      originalQuery: latestUserText,
      contextualizedQuery,
      citaContextBlock,
      trustedRefs,
      responseContext,
      runtimeEnvironmentContext: environmentContext,
      askSystemContent,
      trustedAskUserProfile,
      nativeFcSystemContent,
      actionGateSystemPrompt,
      timeoutMs: deps.chatRequestTimeoutMs,
      toolSystemContent,
      soulSystemBaseContent,
      soulSampling,
      ...(socialContextEnabled && input.userTurnId && input.assistantTurnId ? {
        socialContext: {
          enabled: true as const,
          conversationId,
          userTurnId: input.userTurnId,
          assistantTurnId: input.assistantTurnId,
          retrievedAtoms: retrievedSocialAtoms,
          now: Date.now(),
        },
      } : {}),
      ...(imageCaptionFallback ? { imageCaptionFallback } : {}),
      ...(isChatMode ? { tools: runTools as ToolDefinition[] } : {}),
      ...(availableSkills.length > 0 ? { availableSkills } : {}),
    },
    latestUserText,
  };
}

/**
 * Side effects after agent completes run: memory + expression/sticker inference + broadcast.
 * Completely identical in behavior to original index.ts AG-UI bridge onRunFinished.
 *
 * Note: feeling field is updated by inferRuntimeState internal side effect; this function only syncs status/expression/updatedAt.
 *
 * Channel (wechat/feishu/...) stickers go through OutgoingMessage.parts (unified message model);
 * Desktop chat window retains IPC broadcast (backwards compatibility + desktop renderer sticker selector depends on this event).
 * Both derive from the same sticker decision and will not duplicate.
 */
export async function onAgentRunFinished(
  result: CyreneRunResult,
  latestUserText: string,
  deps: OnRunFinishedDeps,
  channel?: "wechat" | "feishu",
): Promise<{ sticker: string | null }> {
  const chatContent = result.reply;
  const sideEffectUserText = stripTurnModelContextForSideEffects(latestUserText);
  const socialContext = result.executionMode === "chat" && result.socialContext?.enabled === true
    ? result.socialContext
    : undefined;
  const usesSocialExtractor = Boolean(socialContext);
  if (socialContext) {
    deps.scheduleSocialAtomExtraction?.({
      conversationId: socialContext.conversationId,
      userTurn: {
        id: socialContext.userTurnId,
        role: "user",
        text: sideEffectUserText,
      },
      assistantTurn: {
        id: socialContext.assistantTurnId,
        role: "assistant",
        text: chatContent,
      },
      retrievedAtoms: socialContext.retrievedAtoms,
      now: socialContext.now,
    });
  } else {
    deps.scheduleMemoryWrite(sideEffectUserText, chatContent);
  }

  const settings = deps.loadModelSettings();
  const inferredStatus = deps.inferRuntimeState(sideEffectUserText, chatContent, false);
  deps.setRuntimeState({
    status: inferredStatus.status,
    expression: deps.feelingToExpression[deps.runtimeState.feeling ?? ""] ?? 0,
    updatedAt: Date.now(),
  });

  await perf.track("record_relationship_turn", async () => {
    await deps.recordRelationshipTurn({
      userText: sideEffectUserText,
      assistantText: chatContent,
      cyreneFeeling: deps.runtimeState.feeling ?? "Calm",
      channel: channel ?? "desktop",
    });
  });

  const stickerIndex = deps.getStickerEmbeddingIndex?.() ?? deps.stickerEmbeddingIndex;
  const stickerQuery = (chatContent + "\n" + sideEffectUserText).slice(0, 1000);
  let stickerCandidate: string | null = null;
  if (settings.stickerEnabled && stickerIndex) {
    const matched = await perf.track("match_sticker", () =>
      deps.matchSticker(
        stickerQuery,
        deps.getEmbeddingProvider(),
        stickerIndex,
        settings.stickerSimilarityThreshold ?? 0.55,
      ),
    );
    stickerCandidate = matched?.id ?? null;
  }
  const stickerSettings = deps.loadStickerSettings();
  const sticker = stickerCandidate && stickerSettings[stickerCandidate] !== false ? stickerCandidate : null;

  const chatWin = deps.getChatWindow();
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.webContents.send(IPC.AGUI_EVENT, {
      type: "CUSTOM",
      name: "cyrene.sticker",
      value: sticker,
    });
  }
  if (settings.runtimeSync === "local") {
    if (deps.inferFeelingState) {
      const localFeeling = deps.inferFeelingState(sideEffectUserText + " " + chatContent);
      deps.setRuntimeState({
        feeling: localFeeling,
        expression: deps.feelingToExpression[localFeeling] ?? 0,
        updatedAt: Date.now(),
      });
    }
    deps.broadcastRuntimeStateChanged();
  } else if (settings.runtimeSync === "llm") {
    deps.broadcastRuntimeStateChanged();
    // Mood observer is skipped on channel bots (wechat/feishu): saves one LLM call and speeds up first reply
    // Desktop chat (channel === undefined) runs normally to keep Live2D expression/mood aligned with conversation
    if (!usesSocialExtractor && channel !== "wechat" && channel !== "feishu") {
      void deps.observeRuntimeState(settings, [], sideEffectUserText, chatContent);
    }
  }

  // Return sticker decision:
  // - Desktop chat window sticker continues to be handled by IPC broadcast (above chatWin.webContents.send)
  // - Channel (wechat/feishu/...) stickers are received by dispatcher and included in OutgoingMessage.parts
  // - Desktop path also returns sticker to maintain signature consistency; dispatcher consumes it only when channel !== undefined
  return { sticker };
}
