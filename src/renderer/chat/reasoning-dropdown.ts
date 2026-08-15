// Chat 窗口推理下拉 —— 按 (providerId, model) capability 动态生成选项。
//
// 入口：computeReasoningDropdown(providerId, model, savedPreference)
// 返回 ReasoningDropdownView，由 chat/main.ts 在真实 DOM 上构建选项。
//
// 控件形态（按 capability.control）：
// - fixed-on：始终开启，控件 disabled，单项 disabled
// - dynamic：跟随动态路由，控件 disabled，单项 disabled
// - none：未配置推理控制，控件 disabled，单项 disabled
// - toggle（无 supportedEfforts）：跟随模型 / [关闭] / 开启
// - effort / toggle-effort（带 supportedEfforts）：跟随模型 / [关闭] / supportedEfforts.map
//
// 注意：effective 必须用 resolveEffectiveReasoning(saved, capability) 计算，
// 不能直接 saved ?? auto。原因：fixed-on 模型即使 saved=off，effective.mode 仍为 on；
// saved.effort 不被支持时 effective.effort 应退回 defaultEffort。

import {
  resolveEffectiveReasoning,
  resolveReasoningCapability,
  type ReasoningEffort,
  type ReasoningPreference,
} from "../../shared/reasoning";

export interface ReasoningDropdownItem {
  label: string;
  preference: ReasoningPreference;
  /** 该 item 不可点击（fixed-on / dynamic / none 的唯一项） */
  disabled?: boolean;
  /** tooltip 提示 */
  hint?: string;
}

export interface ReasoningDropdownView {
  /** 整个下拉禁用（fixed-on / dynamic / none）：trigger 也不可点 */
  disabled: boolean;
  /** 触发按钮上显示的文案（用户当前 effective 状态） */
  statusText: string;
  /** 当前选中的 item preference（与 saved 可能不同——saved 是用户偏好，effective 是能力归一化后的值） */
  activePreference: ReasoningPreference;
  items: ReasoningDropdownItem[];
}

const EFFORT_LABEL: Record<ReasoningEffort, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Very High",
  max: "Max",
};

export function computeReasoningDropdown(
  providerId: string,
  model: string,
  saved: ReasoningPreference | undefined,
): ReasoningDropdownView {
  const cap = resolveReasoningCapability(providerId, model);
  const effective = resolveEffectiveReasoning(saved, cap);

  // ── fixed-on: always on, control disabled, single disabled item ──
  if (cap.control === "fixed-on") {
    return {
      disabled: true,
      statusText: "Always On",
      activePreference: effective,
      items: [
        {
          label: "Always On",
          preference: { mode: "on" },
          disabled: true,
          hint: "This model always thinks and cannot be disabled",
        },
      ],
    };
  }

  // ── dynamic: follows dynamic routing, control disabled ──
  if (cap.control === "dynamic") {
    return {
      disabled: true,
      statusText: "Dynamic Routing",
      activePreference: effective,
      items: [
        {
          label: "Dynamic Routing",
          preference: { mode: "auto" },
          disabled: true,
          hint: "Determined by dynamic routing",
        },
      ],
    };
  }

  // ── none: reasoning control not configured, control disabled ──
  if (cap.control === "none") {
    return {
      disabled: true,
      statusText: "Default",
      activePreference: effective,
      items: [
        {
          label: "Default",
          preference: { mode: "auto" },
          disabled: true,
          hint: "Reasoning control is not configured for current model",
        },
      ],
    };
  }

  // ── toggle (no supportedEfforts): Default / [Off] / On ──
  if (cap.control === "toggle") {
    const items: ReasoningDropdownItem[] = [
      { label: "Default", preference: { mode: "auto" } },
    ];
    if (cap.supportsDisable) {
      items.push({ label: "Off", preference: { mode: "off" } });
    }
    items.push({ label: "On", preference: { mode: "on" } });
    return {
      disabled: false,
      statusText: statusTextFor(effective),
      activePreference: effective,
      items,
    };
  }

  // ── effort / toggle-effort (with supportedEfforts) ──
  const efforts = cap.supportedEfforts ?? [];
  const items: ReasoningDropdownItem[] = [
    { label: "Default", preference: { mode: "auto" } },
  ];
  if (cap.supportsDisable) {
    items.push({ label: "Off", preference: { mode: "off" } });
  }
  for (const e of efforts) {
    items.push({ label: EFFORT_LABEL[e], preference: { mode: "on", effort: e } });
  }
  return {
    disabled: false,
    statusText: statusTextFor(effective),
    activePreference: effective,
    items,
  };
}

function statusTextFor(effective: ReasoningPreference): string {
  if (effective.mode === "auto") return "Default";
  if (effective.mode === "off") return "Off";
  if (effective.effort) return EFFORT_LABEL[effective.effort];
  return "On";
}

/** statusText displayed on dropdown trigger button: prefix "Reasoning · " */
export function formatReasoningTriggerLabel(statusText: string): string {
  return `Reasoning · ${statusText}`;
}