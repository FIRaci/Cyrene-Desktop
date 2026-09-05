export type ImageSendStrategy = { mode: "direct" } | { mode: "caption" };

export interface ImageSendStrategyConfig {
  /** Whether primary model is multimodal. When true, images are sent directly to primary model (direct). */
  multimodal: boolean;
  vision?: {
    baseUrl: string;
    model: string;
    apiKey: string;
  } | null;
}

/**
 * Decides image sending strategy based on user multimodal setting:
 * - multimodal=true  -> direct (images sent directly with message)
 * - multimodal=false -> caption (analyzed via separate vision model, or image viewing disabled)
 */
export function decideImageSendStrategy(config: ImageSendStrategyConfig): ImageSendStrategy {
  if (config.multimodal) return { mode: "direct" };
  return { mode: "caption" };
}
