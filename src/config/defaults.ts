import { WinnowConfig } from "./schema.js";

export function applyProfileDefaults(config: WinnowConfig): WinnowConfig {
  if (config.profile === "learning_zh") {
    return {
      ...config,
      outputMode: "en_to_zh",
      showOriginal: true,
    };
  }

  return config;
}
