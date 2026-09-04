// 工具注册表 — 统一管理所有可被 LLM Router 调度的工具
// Worldbook 不在此注册，它走独立常驻检索路径

import { searchMemory } from "../rag/index";
import type { ToolRiskLevel } from "../permission";
import type { ToolContext } from "./tool-context";
import type { SoulProjectionConfig, SoulClaimKind } from "./soul-execution-context";

/** 工具完成证据元数据：供 Planner 生成 completionCriteria 和 planVerify 校验 */
export interface CapabilityCompletionEvidence {
  kind: "tool_succeeded" | "projection_claim";
  claimKind?: SoulClaimKind;
}

/** JSON Schema 片段：参数可以是简单类型，也可以是 array/object（含 items/properties）。 */
export type JsonSchemaProp =
  | { type: string; description?: string; enum?: string[] }
  | { type: "array"; description?: string; items: JsonSchemaProp }
  | { type: "object"; description?: string; properties: Record<string, JsonSchemaProp>; required?: string[] };

/** 控制输入策略：简单字符串或带 kind 的对象形式 */
export type ControlledInputPolicy =
  | "context_ref"
  | "context_ref_array"
  | "tool_result"
  | { type: "context_ref"; kind: string }
  | { type: "context_ref_array"; kind: string }
  | { type: "tool_result" };

/** 从 ControlledInputPolicy 提取底层策略类型字符串 */
export function controlledInputType(policy: ControlledInputPolicy): string {
  return typeof policy === "string" ? policy : policy.type;
}

/** 从 ControlledInputPolicy 提取 expectedKind（如有） */
export function controlledInputKind(policy: ControlledInputPolicy): string | undefined {
  return typeof policy === "object" && "kind" in policy ? policy.kind : undefined;
}

export interface ToolDefinition {
  id: string;           // 工具唯一标识，如 "imported_docs"
  name: string;         // 展示名，如 "导入文档"
  description: string;  // 一句话描述，供 LLM Router 的 Prompt 使用
  /** 工具目录里展示的一句话用途（可选）。未填时回落 description 第一行。
   *  只用于运行时生成的工具目录，完整参数仍走 tools Schema。 */
  catalogHint?: string;
  /** 可选分类标签，第一期暂不强制使用。 */
  category?: string;
  /** Action Gate 使用的稳定能力标识；未填时回落到工具 id。 */
  capability?: string;
  /** Runtime 校验受控参数来源；这些值不能由模型自由编造。支持带 kind 的对象形式用于类型化引用验证。 */
  controlledInput?: Record<string, ControlledInputPolicy>;
  enabled: boolean;     // 用户是否启用（对应设置面板的开关）
  // 危险等级：决定该工具在哪些权限档位下可调用；不填默认 "safe"
  risk?: ToolRiskLevel;
  // MCP 兼容字段：参数 schema，后续接 MCP 时直接复用
  inputSchema: {
    type: "object";
    properties: Record<string, JsonSchemaProp>;
    required?: string[];
  };
  /** 工具若声明 needsContext，调度层执行时会传入 ToolContext。默认不声明=不传。 */
  needsContext?: boolean;
  /** Soul 上下文中替代 toolId 的安全语义名称 */
  soulActionLabel?: string;
  /** 声明式 Soul 投影配置 */
  soulProjection?: SoulProjectionConfig;
  /** 工具专用错误码 -> 用户安全消息 */
  soulErrorMessages?: Record<string, string>;
  /** 完成证据元数据：供 Planner 和 planVerify 使用。未配置的工具不能进入 Plan 步骤。 */
  completionEvidence?: CapabilityCompletionEvidence[];
  /** Plan 模式下不暴露给 Action Gate 和 Native FC（防止 Plan 步骤降级到旧 Loop）。 */
  hideInPlanMode?: boolean;
  // 执行器：内置工具指向本地函数，外部 MCP 工具指向 transport 调用
  execute: (args: Record<string, unknown>, ctx?: ToolContext) => Promise<string>;
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.id, tool);
  }

  unregister(id: string): boolean {
    return this.tools.delete(id);
  }

  setEnabled(id: string, enabled: boolean): void {
    const tool = this.tools.get(id);
    if (tool) {
      tool.enabled = enabled;
    }
  }

  getEnabledTools(): ToolDefinition[] {
    return Array.from(this.tools.values()).filter(t => t.enabled && isCompanionSafeTool(t));
  }

  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getById(id: string): ToolDefinition | undefined {
    return this.tools.get(id);
  }
}

/** The model only sees capabilities the application can enforce without arbitrary mutation/process escape. */
export function isCompanionSafeTool(tool: Pick<ToolDefinition, "risk" | "id">): boolean {
  if (tool.id === "install_mcp_server") return false;
  // Fail closed: every model-visible tool must explicitly declare its capability risk.
  const risk = tool.risk;
  if (!risk) return false;
  return risk === "safe" || risk === "fs-read" || risk === "network" || risk === "input-control";
}

// 全局单例
export const toolRegistry = new ToolRegistry();

// ── 注册内置工具 ──────────────────────────────────────────

function formatMemoryResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return "";
  const record = result as { text?: unknown; entry?: { text?: unknown } };
  if (typeof record.entry?.text === "string") return record.entry.text;
  if (typeof record.text === "string") return record.text;
  return "";
}

toolRegistry.register({
  id: 'imported_docs',
  name: 'Imported documents',
  description:
    'Semantically searches documents, novels, and files imported by the user and returns relevant excerpts.\n\n' +
    'Use it when:\n' +
    '- The user refers to a file, document, novel, or an uploaded-file marker\n' +
    '- The answer may be in an imported document\n' +
    '- The user asks you to find something in a document or novel\n\n' +
    'Do not use it for:\n' +
    '- Arbitrary local files (use read_file)\n' +
    '- Facts from previous conversations (use user_memory)\n' +
    '- Online information (use web_search)\n\n' +
    'Arguments: query (required search query), topK (optional result count, default 5).',
  enabled: true,
  risk: 'safe',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      topK:  { type: 'number', description: 'Number of results; defaults to 5' },
    },
    required: ['query'],
  },
  execute: async (args) => {
    const results = await searchMemory(String(args.query), 'imported_doc', Number(args.topK) || 5);
    return results.map((r: unknown) => String(r)).join('\n');
  },
});

toolRegistry.register({
  id: 'user_memory',
  name: 'User memory',
  description:
    'Searches memories, personal details, and facts the user mentioned in earlier conversations.\n\n' +
    'Use it when:\n' +
    '- The user asks whether you remember something they said before\n' +
    '- The user asks about their preferences, habits, or background\n' +
    '- You need to verify a specific detail previously shared by the user\n\n' +
    'Do not use it for:\n' +
    '- Information already visible in the recent conversation\n' +
    '- Imported document content (use imported_docs)\n' +
    '- Information the user never shared; say you do not know when no memory is found\n\n' +
    'Arguments: query (required search query), topK (optional result count, default 5).',
  enabled: true,
  risk: 'safe',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      topK:  { type: 'number', description: 'Number of results; defaults to 5' },
    },
    required: ['query'],
  },
  execute: async (args) => {
    const results = await searchMemory(String(args.query), 'user_memory', Number(args.topK) || 5);
    return results.map(formatMemoryResult).filter(Boolean).join('\n');
  },
});

