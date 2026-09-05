// IPC channel names shared between main and renderer
export interface ScreenshotInsertPayload {
  mime: "image/png";
  width: number;
  height: number;
  filePath: string;
  previewUrl: string;
  hasAnnotations: boolean;
}

export const IPC = {
  // pet window
  WINDOW_MINIMIZE: "window:minimize",
  WINDOW_CLOSE: "window:close",
  WINDOW_DRAG_START: "window:drag-start",
  WINDOW_SET_INTERACTIVE: "window:set-interactive",
  WINDOW_MOVE: "window:move",
  WINDOW_MOVE_TO: "window:move-to",
  WINDOW_SET_DRAGGING: "window:set-dragging",
  WINDOW_CAPTURE_FRAME: "window:capture-frame",
  WINDOW_GET_CURSOR_POSITION: "window:get-cursor-position",
  PET_VISIBILITY_CHANGED: "pet:visibility-changed",
  PET_AGENT_EVENT: "pet:agent-event",
  PET_SHOW_CONTEXT_MENU: "pet:show-context-menu",
  PET_TOGGLE_MINI_CHAT: "pet:toggle-mini-chat",
  PET_TOGGLE_VOICE: "pet:toggle-voice",
  PET_SPEAK: "pet:speak",
  APP_QUIT: "app:quit",

  // log window (response & activity log)
  LOG_GET_ENTRIES: "log:get-entries",
  LOG_ENTRY: "log:entry",
  LOG_CLOSE: "log:close",
  LOG_MINIMIZE: "log:minimize",
  LOG_CLEAR: "log:clear",
  LOG_PUSH_ENTRY: "log:push-entry",
  LOG_CLEARED: "log:cleared",

  // chat window
  CHAT_MINIMIZE: "chat:minimize",
  CHAT_CLOSE: "chat:close",
  CHAT_TOGGLE_MAXIMIZE: "chat:toggle-maximize",
  CHAT_IS_MAXIMIZED: "chat:is-maximized",
  CHAT_INGEST_FILES: "chat:ingest-files",
  CHAT_PROCESS_DOCUMENTS: "chat:process-documents",
  CHAT_DOCUMENT_INDEX_PROGRESS: "chat:document-index-progress",
  CHAT_CANCEL_DOCUMENT_INDEX: "chat:cancel-document-index",
  CHAT_CAPTION_IMAGE: "chat:caption-image",
  CHAT_GET_IMAGE_SEND_STRATEGY: "chat:get-image-send-strategy",
  // Reasoning dropdown (chat window: atomic read + providerKey write)
  CHAT_GET_REASONING_STATE: "chat:get-reasoning-state",
  CHAT_SET_REASONING: "chat:set-reasoning",

  // AG-UI event stream
  AGUI_RUN: "agui:run",
  AGUI_EVENT: "agui:event",
  AGUI_CANCEL: "agui:cancel",
  SCHEDULER_EVENT: "scheduler:event",

  // sidebar window (status / schedule / settings entry)
  SIDEBAR_MINIMIZE: "sidebar:minimize",
  SIDEBAR_CLOSE: "sidebar:close",
  SIDEBAR_TOGGLE_ALWAYS_ON_TOP: "sidebar:toggle-always-on-top",
  SIDEBAR_OPEN_SETTINGS: "sidebar:open-settings",
  SIDEBAR_OPEN_TASKS: "sidebar:open-tasks",
  SIDEBAR_OPEN_CALL: "sidebar:open-call",

  // tasks window (read-only display, no per-element interactions)
  TASKS_CLOSE: "tasks:close",
  TASKS_MINIMIZE: "tasks:minimize",

  // settings window
  SETTINGS_MINIMIZE: "settings:minimize",
  SETTINGS_CLOSE: "settings:close",
  // main -> settings window: Request switch to specified tab (when already open)
  SETTINGS_SWITCH_SECTION: "settings:switch-section",
  SETTINGS_GET_CONFIG: "settings:get-config",
  SETTINGS_SAVE_CONFIG: "settings:save-config",
  SETTINGS_TEST_CONNECTION: "settings:test-connection",
  SETTINGS_TEST_VISION: "settings:test-vision",
  SETTINGS_GET_GENERAL: "settings:get-general",
  SETTINGS_SAVE_GENERAL: "settings:save-general",
  UI_THEME_GET: "ui-theme:get",
  UI_THEME_CHANGED: "ui-theme:changed",
  UI_FONT_GET: "ui-font:get",
  UI_FONT_CHANGED: "ui-font:changed",
  SETTINGS_PICK_UI_FONT: "settings:pick-ui-font",
  SETTINGS_IMPORT_UI_FONT: "settings:import-ui-font",
  SETTINGS_RESET_UI_FONT: "settings:reset-ui-font",
  SETTINGS_OPEN_SIDEBAR: "settings:open-sidebar",
  SETTINGS_CLOSE_SIDEBAR: "settings:close-sidebar",
  SETTINGS_OPEN_TASKS: "settings:open-tasks",
  SETTINGS_CLOSE_TASKS: "settings:close-tasks",
  SETTINGS_SET_PET_ALWAYS_ON_TOP: "settings:set-pet-always-on-top",
  SETTINGS_SET_PET_VISIBLE: "settings:set-pet-visible",
  SETTINGS_SET_PET_ZOOM: "settings:set-pet-zoom",
  // main -> pet window: Push current zoom factor, renderer recalculates scale accordingly
  PET_ZOOM: "pet:zoom",
  SETTINGS_PREVIEW_RUNTIME_SYNC: "settings:preview-runtime-sync",
  SETTINGS_OPEN_STICKER_MANAGER: "settings:open-sticker-manager",
  SETTINGS_OPEN_CUSTOM_STYLE_PROMPT: "settings:open-custom-style-prompt",

  // chat sessions (multi-conversation history, persisted to userData/cyrene-chats/)
  CHATS_LIST: "chats:list",
  CHATS_GET: "chats:get",
  CHATS_GET_PAGE: "chats:get-page",
  CHATS_CREATE: "chats:create",
  CHATS_APPEND: "chats:append",
  CHATS_REPLACE_MESSAGES: "chats:replace-messages",
  CHATS_REPLACE_TAIL: "chats:replace-tail",
  CHATS_RENAME: "chats:rename",
  CHATS_DELETE: "chats:delete",
  CHATS_OPEN_FOLDER: "chats:open-folder",
  CHATS_MIGRATE_LEGACY: "chats:migrate-legacy",
  // Broadcast from main to all renderer windows after any session change, triggering list/title refresh
  CHATS_CHANGED: "chats:changed",
  // Settings center -> main: Request opening chat window and loading specified sessionId
  CHATS_OPEN_IN_CHAT_WINDOW: "chats:open-in-chat-window",
  // main -> chat window: Request switch to specified sessionId (when window exists)
  CHATS_SWITCH_SESSION: "chats:switch-session",
  // Chat window -> main: Declare current active sessionId (for differentiated prompt when deleting in settings)
  CHATS_SET_ACTIVE_SESSION: "chats:set-active-session",
  // renderer -> main: Query current active sessionId (used when settings panel first opens)
  CHATS_GET_ACTIVE_SESSION: "chats:get-active-session",
  // main -> all windows: Broadcast when active sessionId changes
  CHATS_ACTIVE_SESSION_CHANGED: "chats:active-session-changed",

// sticker manager window
	  STICKERS_MINIMIZE: "stickers:minimize",
	  STICKERS_CLOSE: "stickers:close",
	  STICKERS_GET_CONFIG: "stickers:get-config",
	  STICKERS_SET_ENABLED: "stickers:set-enabled",
	  STICKERS_PICK_FILE: "stickers:pick-file",
	  STICKERS_ADD: "stickers:add",
	  STICKERS_DELETE: "stickers:delete",
	  STICKERS_GET_ENABLED: "stickers:get-enabled",

  // public model config updates (no API key)
  MODEL_CONFIG_GET: "model-config:get",
  MODEL_CONFIG_CHANGED: "model-config:changed",

  // runtime state updates (status / feeling / expression)
  RUNTIME_STATE_GET: "runtime-state:get",
  RUNTIME_STATE_CHANGED: "runtime-state:changed",

  // Live2D speech / mouth sync
  LIVE2D_SPEECH_PREPARE: "live2d:speech-prepare",
  LIVE2D_MOUTH_START: "live2d:mouth-start",
  LIVE2D_MOUTH_STOP: "live2d:mouth-stop",
  LIVE2D_PLAY_ACTION: "live2d:play-action",        // Main process -> pet window: Execute action (motion or expression)
  LIVE2D_GET_MAIN_DIAGNOSTICS: "live2d:get-main-diagnostics",
  // embedding model status
  EMBEDDING_GET_STATUS: "embedding:get-status",
  EMBEDDING_DOWNLOAD: "embedding:download",
  EMBEDDING_DELETE: "embedding:delete",
  EMBEDDING_PROGRESS: "embedding:progress",
  EMBEDDING_SET_MODEL: "embedding:set-model",
  RERANKER_SET_MODE: "reranker:set-mode",
  RERANKER_GET_STATUS: "reranker:get-status",
  // unified model install status
  MODEL_GET_INSTALL_STATUS: "model:get-install-status",
  // shell external URL
  OPEN_EXTERNAL: "shell:open-external",
  // user profile
  USER_GET_PROFILE: "user:get-profile",
  USER_SAVE_PROFILE: "user:save-profile",
  USER_UPLOAD_AVATAR: "user:upload-avatar",
  USER_GET_AVATAR: "user:get-avatar",
  USER_AVATAR_CHANGED: "user:avatar-changed",

  // memory panel
  MEMORY_PANEL_GET_DATA: "memory-panel:get-data",
  MEMORY_PANEL_DELETE_IMPORTED_DOC: "memory-panel:delete-imported-doc",
  MEMORY_PANEL_SAVE_L0: "memory-panel:save-l0",
  MEMORY_PANEL_SAVE_L1: "memory-panel:save-l1",

  // MCP server management
  MCP_ADD_SERVER: "mcp:add-server",
  MCP_REMOVE_SERVER: "mcp:remove-server",
  MCP_LIST_SERVERS: "mcp:list-servers",

  // tool (plugin) toggle
  TOOL_SET_ENABLED: "tool:set-enabled",
  TOOL_GET_ENABLED: "tool:get-enabled",

  // skill toggle
  SKILL_LIST: "skill:list",
  SKILL_SET_ENABLED: "skill:set-enabled",

  // scheduled tasks
  SCHEDULER_LIST: "scheduler:list",
  SCHEDULER_ADD: "scheduler:add",
  SCHEDULER_UPDATE: "scheduler:update",
  SCHEDULER_DELETE: "scheduler:delete",
  SCHEDULER_TOGGLE: "scheduler:toggle",
  SCHEDULER_FIRE_NOW: "scheduler:fire-now",
  SCHEDULER_GET_HISTORY: "scheduler:get-history",
  SCHEDULER_GET_TOOLS: "scheduler:get-tools",
  SCHEDULER_CHANGED: "scheduler:changed",  // main -> renderer: Task list change notification

  // game-bot (Game Automation)
  GAME_BOT_GET_CONFIG: "game-bot:get-config",
  GAME_BOT_SAVE_CONFIG: "game-bot:save-config",
  GAME_BOT_LIST_RECIPES: "game-bot:list-recipes",
  GAME_BOT_LIST_REFS: "game-bot:list-refs",
  GAME_BOT_REFS_DIR: "game-bot:refs-dir",
  GAME_BOT_START: "game-bot:start",
  GAME_BOT_STOP: "game-bot:stop",
  GAME_BOT_PROGRESS: "game-bot:progress",

  // token usage statistics
  TOKEN_USAGE_GET: "token-usage:get",

  // TTS speech synthesis
  TTS_UPLOAD: "tts:upload",          // Upload audio file -> file_id
  TTS_CLONE: "tts:clone",           // Quick voice clone -> voice_id
  TTS_SYNTHESIZE: "tts:synthesize", // Speech synthesis -> audio buffer (base64)
  TTS_SYNTHESIZE_CACHED: "tts:synthesize-cached", // Speech synthesis + local audio cache
  // Streaming speech synthesis (play while synthesizing, low first-byte latency)
  TTS_STREAM_START: "tts:stream-start",           // Renderer -> main: Start streaming synthesis
  TTS_AUDIO_CHUNK: "tts:audio-chunk",             // main -> renderer: Push an audio chunk in base64
  TTS_STREAM_END: "tts:stream-end",               // main -> renderer: Stream ended (includes cacheKey)
  TTS_STREAM_ERROR: "tts:stream-error",           // main -> renderer: Streaming error
  TTS_SAVE_SETTINGS: "tts:save-settings",   // Save TTS config
  TTS_LOAD_SETTINGS: "tts:load-settings",   // Load TTS config
  TTS_PICK_AUDIO: "tts:pick-audio",         // Pick audio file (dialog)
  TTS_SYNTHESIZE_GPTSOVITS: "tts:synthesize-gptsovits",             // GPT-SoVITS synthesis -> base64
  TTS_SYNTHESIZE_CACHED_GPTSOVITS: "tts:synthesize-cached-gptsovits", // GPT-SoVITS synthesis + local cache
  TTS_SYNTHESIZE_CUSTOM_CLOUD: "tts:synthesize-custom-cloud",             // Custom cloud TTS synthesis -> base64
  TTS_SYNTHESIZE_CACHED_CUSTOM_CLOUD: "tts:synthesize-cached-custom-cloud", // Custom cloud TTS synthesis + local cache
  TTS_SYNTHESIZE_MIMO: "tts:synthesize-mimo",             // Xiaomi MiMo TTS synthesis -> base64
  TTS_SYNTHESIZE_CACHED_MIMO: "tts:synthesize-cached-mimo", // Xiaomi MiMo TTS synthesis + local cache
  TTS_SYNTHESIZE_MOSSLAND: "tts:synthesize-mossland",       // Mossland (api.mosi.cn) synthesis -> base64
  TTS_SYNTHESIZE_CACHED_MOSSLAND: "tts:synthesize-cached-mossland", // Mossland synthesis + local cache
  TTS_CLONE_MOSSLAND: "tts:clone-mossland",           // Mossland voice clone (multipart upload)
  TTS_LIST_MOSSLAND_VOICES: "tts:list-mossland-voices", // Mossland list voices under account
  TTS_SYNTHESIZE_ONLINE: "tts:synthesize-online",       // Online Chinese/Multi-language TTS synthesis -> base64
  TTS_TRANSLATE_TO_CHINESE: "tts:translate-to-chinese", // Translate text to Chinese for voice output

  // agent permission level (file/shell access)
  PERMISSION_GET_LEVEL: "permission:get-level",
  PERMISSION_SET_LEVEL: "permission:set-level",
  // main -> renderer: Request approval
  PERMISSION_APPROVAL_REQUEST: "permission:approval-request",
  // renderer -> main: Return approval result
  PERMISSION_APPROVAL_RESOLVE: "permission:approval-resolve",

  // user choice card (ambiguity resolver)
  // Card display uses AGUI_EVENT CUSTOM event (shared channel with weather card)
  // renderer -> main: Return user choice
  CHOICE_RESOLVE: "choice:resolve",

  // call window (voice call)
  CALL_OPEN: "call:open",                 // sidebar -> main: Open call window
  CALL_START: "call:start",               // renderer -> main: Start call (initialize ASR)
  CALL_AUDIO_FRAME: "call:audio-frame",    // renderer -> main: PCM audio frame
  CALL_ASR_RESULT: "call:asr-result",
  CALL_SUBMIT_TEXT: "call:submit-text",     // main -> renderer: ASR recognition result
  CALL_TURN_END: "call:turn-end",         // renderer -> main: VAD silence, end current turn
  CALL_TTS_AUDIO: "call:tts-audio",       // main -> renderer: TTS audio
  CALL_TTS_DONE: "call:tts-done",         // renderer -> main: TTS playback completed
  CALL_STATE: "call:state",               // main -> renderer: State change
  CALL_ERROR: "call:error",               // main -> renderer: Error
  CALL_STOP: "call:stop",                 // renderer -> main: Hang up

  // Multi-channel (Phase 0 skeleton, Phase 1+ WeChat / Feishu)
  CHANNELS_GET_CONFIG: "channels:get-config",
  CHANNELS_SAVE_CONFIG: "channels:save-config",
  CHANNELS_LIST: "channels:list",
  CHANNELS_RESTART: "channels:restart",
  CHANNELS_GET_STATUS: "channels:get-status",
  CHANNELS_INSTALL_PROGRESS: "channels:install-progress",     // main → renderer
  CHANNELS_STATUS_CHANGED: "channels:status-changed",         // main → renderer
  // WeChat specific
  CHANNELS_WECHAT_INSTALL: "channels:wechat:install",
  CHANNELS_WECHAT_LOGIN_START: "channels:wechat:login-start",
  CHANNELS_WECHAT_LOGIN_CANCEL: "channels:wechat:login-cancel",
  CHANNELS_WECHAT_QRCODE: "channels:wechat:qrcode",        // main → renderer, payload: dataURL string
  CHANNELS_WECHAT_LOGIN_DONE: "channels:wechat:login-done", // main → renderer, payload: { ok, botId?, error? }
  CHANNELS_WECHAT_LOGIN_RESULT: "channels:wechat:login-result",
  CHANNELS_WECHAT_PAIRING_LIST: "channels:wechat:pairing-list",
  CHANNELS_WECHAT_PAIRING_APPROVE: "channels:wechat:pairing-approve",
  CHANNELS_WECHAT_LOGOUT: "channels:wechat:logout",
  CHANNELS_WECHAT_RUNTIME_DETECT: "channels:wechat:runtime-detect",
  CHANNELS_WECHAT_RUNTIME_INSTALL: "channels:wechat:runtime-install",
  CHANNELS_WECHAT_RUNTIME_UPDATE: "channels:wechat:runtime-update",
  // Feishu specific
  CHANNELS_FEISHU_TEST_CONNECTION: "channels:feishu:test-connection",
  CHANNELS_FEISHU_TEST_WEBHOOK_REACHABLE: "channels:feishu:test-webhook-reachable",
  // Phase 3.4: Message log
  CHANNELS_LOG_GET: "channels:log:get",
  CHANNELS_LOG_CLEAR: "channels:log:clear",

  // Music
  MUSIC_GET_STATUS: "music:get-status",
  MUSIC_BEGIN_LOGIN: "music:begin-login",
  MUSIC_CANCEL_LOGIN: "music:cancel-login",
  MUSIC_LOGOUT: "music:logout",
  MUSIC_GET_DAILY: "music:get-daily",
  MUSIC_SEARCH: "music:search",
  MUSIC_PRESENT_TRACKS: "music:present-tracks",
  MUSIC_PLAY_TRACK: "music:play-track",
  MUSIC_PLAY_PLAYLIST: "music:play-playlist",
  MUSIC_DETECT_PLAYER: "music:detect-player",
  MUSIC_STATE_CHANGED: "music:state-changed",
  MUSIC_CARD: "music:card",

  // screenshot & co-watching
  SCREENSHOT_START: "screenshot:start",
  SCREENSHOT_SAVE_TEMP: "screenshot:save-temp",
  SCREENSHOT_INSERT: "screenshot:insert",
  SCREENSHOT_HOTKEY_CAPTURE_START: "screenshot:hotkey-capture-start",
  SCREENSHOT_HOTKEY_CAPTURE_END: "screenshot:hotkey-capture-end",
  SCREENSHOT_INSTANT_LOOK: "screenshot:instant-look",
  // Co-watch persistent mode (auto-capture loop)
  COWATCH_TOGGLE: "cowatch:toggle",
  COWATCH_GET_STATE: "cowatch:get-state",
  COWATCH_STATE_CHANGED: "cowatch:state-changed",
  COWATCH_TRIGGER_OBSERVATION: "cowatch:trigger-observation",

  // Auto Updater
  APP_CHECK_FOR_UPDATES: "app:check-for-updates",

  // Weather Telemetry
  WEATHER_GET_CURRENT: "weather:get-current",
} as const;

