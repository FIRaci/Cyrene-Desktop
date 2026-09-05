import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { describe, expect, it, vi } from "vitest"
import {
  buildAgentRunOptions,
  buildChannelSystem,
  onAgentRunFinished,
  type BuildOptionsDeps,
  type OnRunFinishedDeps,
} from "./build-options"
import type { SocialAtom } from "../social-context/types"

function createBuildDeps(): BuildOptionsDeps {
  return {
    loadModelSettings: () => ({ provider: "test", baseUrl: "https://example.test", model: "m", apiKey: "k" }),
    loadGeneralSettings: () => ({
      currentStyleId: "default",
      customStyle: { diversity: { driver: "model-default" }, repetition: "model-default" },
      chatSocialContextEnabled: false,
    }),
    loadUserProfile: () => ({}),
    buildEnvironmentContext: () => "ENV",
    buildSkillCatalog: () => "",
    buildAutoInjectedSkillContext: () => "",
    skillRegistry: { getEnabled: () => [] },
    resolveSlashActivation: () => "",
    buildToneInjection: async () => "",
    sceneEmbeddingIndex: null,
    getSceneEmbeddingProvider: () => null,
    buildAlwaysOnContext: async () => "ALWAYS",
    buildRelationshipContext: async () => "RELATIONSHIP",
    buildSystemPrompt: () => "BASE_SYSTEM",
    buildToolSystemPrompt: () => "TOOL_SYSTEM",
    buildSoulSystemBasePrompt: () => "SOUL_SYSTEM_BASE",
    readStylePrompt: (styleId) => `STYLE_PROMPT:${styleId}`,
    resolveSoulSampling: () => ({}),
    toolRegistry: { getEnabled: () => [] },
    logWorldbookInjection: () => {},
    normalizeChatMessages: (raw) => raw as never,
    chatRequestTimeoutMs: 1000,
    loadActionGateSystemPrompt: () => "",
    loadNativeFcSystemPrompt: () => "",
    loadAskSystemPrompt: () => "ASK_SYSTEM",
    loadAskPersonaPrompt: () => "ASK_PERSONA",
    loadAskQuotesPrompt: () => "ASK_QUOTES",
  }
}

describe("build-options", () => {
  it("allows the primary orchestrator to use local Ollama without an API key", async () => {
    const deps = createBuildDeps()
    deps.loadModelSettings = () => ({
      provider: "Custom Endpoint (Local)",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "llama3.1:latest",
      apiKey: "",
    })

    const result = await buildAgentRunOptions({
      messages: [{ role: "user", content: "Hello" }],
    }, deps)

    expect(result.options.settings).toMatchObject({
      provider: "Custom Endpoint (Local)",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "llama3.1:latest",
      apiKey: "",
    })
  })

  it("still requires an API key for an explicitly selected cloud provider", async () => {
    const deps = createBuildDeps()
    deps.loadModelSettings = () => ({
      provider: "MiniMax",
      baseUrl: "https://api.minimaxi.com/v1",
      model: "MiniMax-M3",
      apiKey: "",
    })

    await expect(buildAgentRunOptions({
      messages: [{ role: "user", content: "Hello" }],
    }, deps)).rejects.toThrow("No API key is configured for the selected cloud provider")
  })

  it("builds the lightweight Ask Soul prompt in the approved order with trusted identity only", async () => {
    const deps = createBuildDeps()
    deps.loadUserProfile = () => ({
      nickname: "Alex",
      callPreference: "partner",
      gender: "male",
      birthday: "2000-01-01",
      defaultCity: "London",
    })

    const result = await buildAgentRunOptions({
      messages: [{ role: "user", content: "Generate a document" }],
      style: "01_default.md",
    }, deps)
    const askOptions = result.options as typeof result.options & {
      askSystemContent?: string
      trustedAskUserProfile?: Record<string, unknown>
    }

    expect(askOptions.askSystemContent).toBe("ASK_SYSTEM\n\nASK_PERSONA\n\nASK_QUOTES")
    expect(askOptions.trustedAskUserProfile).toEqual({
      nickname: "Alex",
      callPreference: "partner",
      gender: "male",
    })
  })

  it("passes the trusted runtime environment to the agent decision stages", async () => {
    const result = await buildAgentRunOptions({
      messages: [{ role: "user", content: "Check today's weather for me" }],
      style: "01_default.md",
    }, createBuildDeps())

    expect((result.options as typeof result.options & {
      runtimeEnvironmentContext?: string
    }).runtimeEnvironmentContext).toBe("ENV")
  })

  it("passes the saved reasoning preference into the Agent Runtime", async () => {
    const deps = createBuildDeps()
    deps.loadModelSettings = () => ({
      provider: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro",
      apiKey: "k",
      reasoning: { mode: "off" },
    })

    const result = await buildAgentRunOptions({
      messages: [{ role: "user", content: "Hello" }],
      style: "01_default.md",
    }, deps)

    expect(result.options.settings.reasoning).toEqual({ mode: "off" })
  })

  it("adds a concise WeChat system when the run comes from WeChat", async () => {
    const result = await buildAgentRunOptions({
      messages: [{ role: "user", content: "Hello" }],
      style: "01_default.md",
      channel: "wechat",
    }, createBuildDeps())

    expect(result.options.soulSystemBaseContent).toContain("You are replying to the user through WeChat")
    expect(result.options.soulSystemBaseContent).toContain("SOUL_SYSTEM_BASE")
    expect(result.options.soulSystemBaseContent).toContain("RELATIONSHIP")
    expect(result.options.toolSystemContent).toBe("TOOL_SYSTEM")
  })

  it("does not add channel system for desktop chat", async () => {
    const result = await buildAgentRunOptions({
      messages: [{ role: "user", content: "Hello" }],
      style: "01_default.md",
    }, createBuildDeps())

    expect(result.options.soulSystemBaseContent).not.toContain("You are replying to the user through WeChat")
    expect(result.options.soulSystemBaseContent).not.toContain("You are replying to the user through Feishu")
  })

  it("messages do not contain system, FC loop dynamically injects per phase", async () => {
    const result = await buildAgentRunOptions({
      messages: [{ role: "user", content: "Hello" }],
      style: "01_default.md",
    }, createBuildDeps())

    // Phase 1: original messages do not contain system message
    expect(result.options.messages.some((m) => m.role === "system")).toBe(false)
  })

  it("adds message timestamps and one gap notice to AG-UI chat context", async () => {
    const deps = createBuildDeps()
    deps.loadUserProfile = () => ({ timezone: "Asia/Taipei" })

    const result = await buildAgentRunOptions({
      messages: [
        { role: "user", content: "A bit tired today", at: Date.UTC(2026, 6, 12, 12, 0) },
        { role: "assistant", content: "Rest early", at: Date.UTC(2026, 6, 12, 12, 2) },
        { role: "user", content: "I'm back", at: Date.UTC(2026, 6, 13, 3, 0) },
      ],
      style: "01_default.md",
    }, deps)

    expect(result.options.messages[0].content).toBe("[2026-07-12 20:00, Asia/Taipei]\nA bit tired today")
    expect(result.options.messages[2].content).toBe("[2026-07-13 11:00, Asia/Taipei]\nI'm back")
    expect(result.options.soulSystemBaseContent).toContain("[CONVERSATION_TIME_CONTEXT]")
    expect(result.options.soulSystemBaseContent).toContain("Time since the previous valid chat message: about 14 hours 58 minutes")
    expect(result.options.soulSystemBaseContent.match(/Time since the previous valid chat message/g)).toHaveLength(1)
    expect(result.options.toolSystemContent).not.toContain("[CONVERSATION_TIME_CONTEXT]")
  })

  it("toolSystemContent / soulSystemBaseContent are separate strings", async () => {
    const result = await buildAgentRunOptions({
      messages: [{ role: "user", content: "Hello" }],
      style: "01_default.md",
    }, createBuildDeps())

    expect(result.options.toolSystemContent).toBe("TOOL_SYSTEM")
    expect(result.options.soulSystemBaseContent).not.toBe("TOOL_SYSTEM")
    expect(result.options.soulSystemBaseContent).toContain("SOUL_SYSTEM_BASE")
  })

  it("builds Chat mode without CITA or tools", async () => {
    const deps = createBuildDeps()
    deps.prepareCitaTurn = vi.fn(async () => ({ contextBlock: "unexpected" }))
    deps.toolRegistry.getEnabled = () => [
      { id: "music_search" },
      { id: "weather" },
    ]

    const result = await buildAgentRunOptions({
      messages: [{ role: "user", content: "Chat with me" }],
      styleId: "lively",
      executionMode: "chat",
    }, deps)

    expect(deps.prepareCitaTurn).not.toHaveBeenCalled()
    expect(result.options.executionMode).toBe("chat")
    expect(result.options.tools).toEqual([])
    expect(result.options.citaContextBlock).toBe("")
    expect(result.options.soulSystemBaseContent).toContain("STYLE_PROMPT:lively")
    expect(result.options.toolSystemContent).not.toContain("STYLE_PROMPT:lively")
  })

  it("adds a bounded social background only to enabled Chat runs", async () => {
    const deps = createBuildDeps()
    const retrievedAtom: SocialAtom = {
      id: "atom-1",
      conversationId: "chat-a",
      type: "long_term",
      content: "User likes the seaside",
      evidenceTurnId: "old-user",
      evidenceQuote: "I like the seaside",
      createdAt: 1,
      status: "active",
    }
    deps.loadGeneralSettings = () => ({
      currentStyleId: "default",
      customStyle: { diversity: { driver: "model-default" }, repetition: "model-default" },
      chatSocialContextEnabled: true,
    })
    deps.buildChatSocialContext = vi.fn(async () => ({
      contextBlock: "[Context for this turn]\n- User likes the seaside",
      retrievedAtoms: [retrievedAtom],
    }))
    const messages = Array.from({ length: 14 }, (_, index) => ({
      role: index % 2 === 0 ? "assistant" : "user",
      content: `message-${index}`,
      at: index + 1,
    }))

    const result = await buildAgentRunOptions({
      messages,
      executionMode: "chat",
      sessionId: "chat-a",
      userTurnId: "user-14",
      assistantTurnId: "assistant-14",
    }, deps)

    expect(deps.buildChatSocialContext).toHaveBeenCalledWith({
      conversationId: "chat-a",
      query: "message-13",
    })
    expect(result.options.messages).toHaveLength(12)
    expect(result.options.soulSystemBaseContent).toContain("User likes the seaside")
    expect(result.options.socialContext).toMatchObject({
      enabled: true,
      conversationId: "chat-a",
      userTurnId: "user-14",
      assistantTurnId: "assistant-14",
      retrievedAtoms: [retrievedAtom],
    })
  })

  it("omits empty social background and never calls it for Work or disabled Chat", async () => {
    const emptyDeps = createBuildDeps()
    emptyDeps.loadGeneralSettings = () => ({
      currentStyleId: "default",
      customStyle: { diversity: { driver: "model-default" }, repetition: "model-default" },
      chatSocialContextEnabled: true,
    })
    emptyDeps.buildChatSocialContext = vi.fn(async () => ({
      contextBlock: "",
      retrievedAtoms: [],
    }))
    const chat = await buildAgentRunOptions({
      messages: [{ role: "user", content: "Hello" }],
      executionMode: "chat",
      sessionId: "chat-a",
      userTurnId: "user-1",
      assistantTurnId: "assistant-1",
    }, emptyDeps)
    expect(chat.options.soulSystemBaseContent).not.toContain("[Context for this turn]")

    const workDeps = createBuildDeps()
    workDeps.loadGeneralSettings = emptyDeps.loadGeneralSettings
    workDeps.buildChatSocialContext = vi.fn(async () => ({
      contextBlock: "unexpected",
      retrievedAtoms: [],
    }))
    await buildAgentRunOptions({
      messages: [{ role: "user", content: "Hello" }],
      executionMode: "work",
    }, workDeps)
    expect(workDeps.buildChatSocialContext).not.toHaveBeenCalled()

    const disabledDeps = createBuildDeps()
    disabledDeps.buildChatSocialContext = vi.fn(async () => ({
      contextBlock: "unexpected",
      retrievedAtoms: [],
    }))
    await buildAgentRunOptions({
      messages: [{ role: "user", content: "Hello" }],
      executionMode: "chat",
    }, disabledDeps)
    expect(disabledDeps.buildChatSocialContext).not.toHaveBeenCalled()
  })

  it("honors an explicit Chat mode for channel runs", async () => {
    const deps = createBuildDeps()
    deps.prepareCitaTurn = vi.fn(async () => ({ contextBlock: "unexpected" }))
    deps.toolRegistry.getEnabled = () => [{ id: "weather" }]
    deps.buildSoulSystemBasePrompt = vi.fn(() => "TALK_SOUL_SYSTEM")

    const result = await buildAgentRunOptions({
      messages: [{ role: "user", content: "How is today going" }],
      style: "01_default.md",
      channel: "wechat",
      executionMode: "chat",
    }, deps)

    expect(deps.prepareCitaTurn).not.toHaveBeenCalled()
    expect(deps.buildSoulSystemBasePrompt).toHaveBeenCalledWith("chat")
    expect(result.options.executionMode).toBe("chat")
    expect(result.options.tools).toEqual([])
  })

  it("keeps selected style prompt and sampling independent from execution mode", async () => {
    const deps = createBuildDeps()
    deps.resolveSoulSampling = ({ styleId }) => (
      styleId === "sweet"
        ? { temperature: 0.82, frequencyPenalty: 0.2 }
        : {}
    )

    const chat = await buildAgentRunOptions({
      messages: [{ role: "user", content: "Chat with me" }],
      styleId: "sweet",
      executionMode: "chat",
    }, deps)
    const work = await buildAgentRunOptions({
      messages: [{ role: "user", content: "Check the weather" }],
      styleId: "sweet",
      executionMode: "work",
    }, deps)

    for (const result of [chat, work]) {
      expect(result.options.soulSystemBaseContent).toContain("STYLE_PROMPT:sweet")
      expect(result.options.soulSampling).toEqual({ temperature: 0.82, frequencyPenalty: 0.2 })
    }
    expect(chat.options.executionMode).toBe("chat")
    expect(work.options.executionMode).toBe("work")
  })

  it("does not locally route an explicit NetEase Cloud search request", async () => {
    const deps = createBuildDeps()
    deps.toolRegistry.getEnabled = () => [{ id: "music_search" }]

    const result = await buildAgentRunOptions({
      messages: [{ role: "user", content: "Search for left turn signal on NetEase Cloud" }],
      styleId: "default",
      executionMode: "chat",
    }, deps)

    expect(result.options).not.toHaveProperty("requiredToolName")
    expect(result.options).not.toHaveProperty("requiredToolArgs")
  })

  it("does not locally route daily recommendations or infer continuations", async () => {
    const deps = createBuildDeps()
    deps.toolRegistry.getEnabled = () => [
      { id: "music_get_daily_recommendations" },
      { id: "music_search" },
    ]

    const daily = await buildAgentRunOptions({
      messages: [{ role: "user", content: "Check today's NetEase Cloud recommendations" }],
      styleId: "default",
      executionMode: "chat",
    }, deps)
    const generic = await buildAgentRunOptions({
      messages: [{ role: "user", content: "A bit bored, want to listen to music" }],
      styleId: "default",
      executionMode: "chat",
    }, deps)

    expect(daily.options).not.toHaveProperty("requiredToolName")
    expect(generic.options).not.toHaveProperty("requiredToolName")
  })

  it("injects CITA as a separate tool-phase block and preserves the original user message", async () => {
    const deps = createBuildDeps()
    deps.prepareCitaTurn = vi.fn(async () => ({
      contextBlock: "[CITA_CONTEXT]\n{\"focusedContexts\":[{\"contextRef\":\"music-candidate-1\"}]}\n[/CITA_CONTEXT]",
      contextPackage: {
        originalQuery: "Second song",
        contextualizedQuery: "Play current NetEase Cloud daily recommendation track 2",
        resolvedReferences: [],
      },
    }))
    const originalUserMessage = { role: "user", content: "Second song" }

    const result = await buildAgentRunOptions({
      messages: [originalUserMessage],
      style: "01_default.md",
      sessionId: "conversation-1",
    }, deps)

    expect(deps.prepareCitaTurn).toHaveBeenCalledTimes(1)
    expect(result.options.conversationId).toBe("conversation-1")
    expect(result.options.messages.at(-1)).toEqual(originalUserMessage)
    expect(result.options.toolSystemContent).toContain("[CITA_CONTEXT]")
    expect(result.options.toolSystemContent).toContain("music-candidate-1")
    expect(result.options.originalQuery).toBe("Second song")
    expect(result.options.contextualizedQuery).toBe("Play current NetEase Cloud daily recommendation track 2")
    expect(result.options.citaContextBlock).toContain("music-candidate-1")
    expect(result.options).not.toHaveProperty("requiredToolName")
    expect(result.options).not.toHaveProperty("requiredToolArgs")
  })

  it("emits no CITA marker when the service is disabled", async () => {
    const deps = createBuildDeps()
    deps.prepareCitaTurn = vi.fn(async () => ({ contextBlock: "" }))

    const result = await buildAgentRunOptions({
      messages: [{ role: "user", content: "Second song" }],
      style: "01_default.md",
      sessionId: "conversation-1",
    }, deps)

    expect(result.options.toolSystemContent).not.toContain("[CITA_CONTEXT]")
  })

  it("puts the enabled Skill catalog into the tool phase so invoke_skill can route", async () => {
    const deps = createBuildDeps()
    deps.buildSkillCatalog = () => "SKILL_CATALOG"

    const result = await buildAgentRunOptions({
      messages: [{ role: "user", content: "So bored" }],
      style: "01_default.md",
    }, deps)

    expect(result.options.toolSystemContent).toContain("SKILL_CATALOG")
    expect(result.options.soulSystemBaseContent).not.toContain("SKILL_CATALOG")
  })

  it("keeps tool-oriented Skill rules out of Soul but retains reply-only strategy", async () => {
    const deps = createBuildDeps()
    deps.buildAutoInjectedSkillContext = () => "AUTO_MUSIC_RULES"
    deps.buildAutoInjectedSoulContext = () => "SOUL_MUSIC_REPLY_RULES"

    const result = await buildAgentRunOptions({
      messages: [{ role: "user", content: "Where are daily recommendations" }],
      style: "01_default.md",
    }, deps)

    expect(result.options.toolSystemContent).toContain("AUTO_MUSIC_RULES")
    expect(result.options.soulSystemBaseContent).not.toContain("AUTO_MUSIC_RULES")
    expect(result.options.soulSystemBaseContent).toContain("SOUL_MUSIC_REPLY_RULES")
  })

  it("attaches direct image content blocks to the latest user message", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-image-direct-"))
    const imagePath = path.join(dir, "image.png")
    fs.writeFileSync(imagePath, Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]))

    const result = await buildAgentRunOptions({
      messages: [
        { role: "user", content: "Previous round" },
        { role: "assistant", content: "Sure" },
        { role: "user", content: "Look at this image" },
      ],
      style: "01_default.md",
      imageAttachments: [{ name: "image.png", filePath: imagePath, mime: "image/png" }],
    }, createBuildDeps())

    const latestUser = result.options.messages.at(-1)
    expect(latestUser?.content).toEqual([
      { type: "text", text: "Look at this image" },
      {
        type: "image_url",
        image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) },
      },
    ])
    // Phase 1: original messages do not contain system, so messages[0] is first user message
    expect(result.options.messages[0].content).toBe("Previous round")
  })

  it("builds caption fallback messages for direct image send failures", async () => {
    const deps = createBuildDeps()
    deps.captionImageForFallback = async () => ({ ok: true, caption: "There is an installation screenshot on screen" })

    const result = await buildAgentRunOptions({
      messages: [{ role: "user", content: "What is wrong with this image?" }],
      style: "01_default.md",
      imageAttachments: [{ name: "setup.png", filePath: "C:\\tmp\\setup.png", mime: "image/png" }],
    }, deps)

    const fallbackMessages = await result.options.imageCaptionFallback?.()
    const userMessage = fallbackMessages?.at(-1)
    expect(userMessage?.content).toContain("What is wrong with this image?")
    expect(userMessage?.content).toContain("setup.png: There is an installation screenshot on screen")
    expect(userMessage?.content).not.toContain("image_url")
  })

  it("has distinct system text for Feishu work chat", () => {
    expect(buildChannelSystem("feishu")).toContain("You are replying to the user through Feishu")
    expect(buildChannelSystem("feishu")).toContain("work context")
  })

  it("records relationship turn after agent run finishes", async () => {
    const recordRelationshipTurn = vi.fn(async () => {})
    const deps: OnRunFinishedDeps = {
      loadModelSettings: () => ({ provider: "test", baseUrl: "", model: "", apiKey: "", runtimeSync: "off" }),
      scheduleMemoryWrite: () => {},
      inferRuntimeState: () => ({ status: "accompanying" }),
      runtimeState: { status: "accompanying", feeling: "gentle", expression: 0, updatedAt: 0 },
      feelingToExpression: { "gentle": 0 },
      setRuntimeState: () => {},
      stickerEmbeddingIndex: null,
      getEmbeddingProvider: () => null,
      matchSticker: async () => null,
      loadStickerSettings: () => ({}),
      broadcastRuntimeStateChanged: () => {},
      observeRuntimeState: async () => {},
      recordRelationshipTurn,
      getChatWindow: () => null,
    }

    await onAgentRunFinished({ reply: "Sure thing", toolResults: [] }, "A bit tired today", deps, "wechat")

    expect(recordRelationshipTurn).toHaveBeenCalledWith({
      userText: "A bit tired today",
      assistantText: "Sure thing",
      cyreneFeeling: "gentle",
      channel: "wechat",
    })
  })

  it("uses the latest sticker embedding index when agent run finishes", async () => {
    const matchSticker = vi.fn(async () => ({ id: "hugtight" }))
    const send = vi.fn()
    const latestIndex = [{ id: "hugtight", embedding: [1, 0] }]
    const deps: OnRunFinishedDeps & { getStickerEmbeddingIndex: () => unknown } = {
      loadModelSettings: () => ({
        provider: "test",
        baseUrl: "",
        model: "",
        apiKey: "",
        runtimeSync: "off",
        stickerEnabled: true,
        stickerSimilarityThreshold: 0.55,
      }),
      scheduleMemoryWrite: () => {},
      inferRuntimeState: () => ({ status: "accompanying" }),
      runtimeState: { status: "accompanying", feeling: "gentle", expression: 0, updatedAt: 0 },
      feelingToExpression: { "gentle": 0 },
      setRuntimeState: () => {},
      stickerEmbeddingIndex: null,
      getStickerEmbeddingIndex: () => latestIndex,
      getEmbeddingProvider: () => ({ embed: async () => [1, 0] }),
      matchSticker,
      loadStickerSettings: () => ({}),
      broadcastRuntimeStateChanged: () => {},
      observeRuntimeState: async () => {},
      recordRelationshipTurn: async () => {},
      getChatWindow: () => ({
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send,
        },
      }),
    }

    await onAgentRunFinished({ reply: "Here, giving you a hug", toolResults: [] }, "So tired today", deps)

    expect(matchSticker).toHaveBeenCalledWith(
      "Here, giving you a hug\nSo tired today",
      expect.anything(),
      latestIndex,
      0.55,
    )
    expect(send).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      name: "cyrene.sticker",
      value: "hugtight",
    }))
  })

  it("does not send document model context into memory or sticker embedding side effects", async () => {
    const scheduleMemoryWrite = vi.fn()
    const matchSticker = vi.fn(async () => null)
    const latestIndex = [{ id: "thinking", embedding: [1, 0] }]
    const hugeDoc = "very long document content ".repeat(1000)
    const latestUserText = [
      "Help me summarize this md",
      "[Files for this turn]\nnotes.md (attachment, content injected into this turn context)",
      `[Document content]\nDocument notes.md content:\n${hugeDoc}`,
    ].join("\n\n")
    const deps: OnRunFinishedDeps = {
      loadModelSettings: () => ({
        provider: "test",
        baseUrl: "",
        model: "",
        apiKey: "",
        runtimeSync: "off",
        stickerEnabled: true,
        stickerSimilarityThreshold: 0.55,
      }),
      scheduleMemoryWrite,
      inferRuntimeState: () => ({ status: "accompanying" }),
      runtimeState: { status: "accompanying", feeling: "gentle", expression: 0, updatedAt: 0 },
      feelingToExpression: { "gentle": 0 },
      setRuntimeState: () => {},
      stickerEmbeddingIndex: latestIndex,
      getEmbeddingProvider: () => ({ embed: async () => [1, 0] }),
      matchSticker,
      loadStickerSettings: () => ({}),
      broadcastRuntimeStateChanged: () => {},
      observeRuntimeState: async () => {},
      recordRelationshipTurn: async () => {},
      getChatWindow: () => null,
    }

    await onAgentRunFinished({ reply: "Summary finished", toolResults: [] }, latestUserText, deps)

    expect(scheduleMemoryWrite).toHaveBeenCalledWith("Help me summarize this md", "Summary finished")
    expect(matchSticker).toHaveBeenCalledWith(
      "Summary finished\nHelp me summarize this md",
      expect.anything(),
      latestIndex,
      0.55,
    )
  })

  it("schedules one social extraction instead of legacy memory for an enabled Chat result", async () => {
    const scheduleMemoryWrite = vi.fn()
    const scheduleSocialAtomExtraction = vi.fn()
    const observeRuntimeState = vi.fn(async () => {})
    const deps: OnRunFinishedDeps = {
      loadModelSettings: () => ({ provider: "test", baseUrl: "", model: "", apiKey: "", runtimeSync: "llm" }),
      scheduleMemoryWrite,
      scheduleSocialAtomExtraction,
      inferRuntimeState: () => ({ status: "accompanying" }),
      runtimeState: { status: "accompanying", feeling: "gentle", expression: 0, updatedAt: 0 },
      feelingToExpression: { "gentle": 0 },
      setRuntimeState: () => {},
      stickerEmbeddingIndex: null,
      getEmbeddingProvider: () => null,
      matchSticker: async () => null,
      loadStickerSettings: () => ({}),
      broadcastRuntimeStateChanged: () => {},
      observeRuntimeState,
      recordRelationshipTurn: async () => {},
      getChatWindow: () => null,
    }
    const retrievedAtoms: SocialAtom[] = []

    await onAgentRunFinished({
      reply: "The sea breeze is indeed very pleasant.",
      toolResults: [],
      executionMode: "chat",
      socialContext: {
        enabled: true,
        conversationId: "chat-a",
        userTurnId: "user-1",
        assistantTurnId: "assistant-1",
        retrievedAtoms,
        now: 100,
      },
    }, "I like the seaside.", deps)

    expect(scheduleMemoryWrite).not.toHaveBeenCalled()
    expect(observeRuntimeState).not.toHaveBeenCalled()
    expect(scheduleSocialAtomExtraction).toHaveBeenCalledWith({
      conversationId: "chat-a",
      userTurn: { id: "user-1", role: "user", text: "I like the seaside." },
      assistantTurn: { id: "assistant-1", role: "assistant", text: "The sea breeze is indeed very pleasant." },
      retrievedAtoms,
      now: 100,
    })
  })
})
