import { WinnowConfig } from "../config/schema.js";
import { DeepSeekTranslator } from "./deepseekTranslator.js";
import { Translator } from "./common.js";
import { OllamaTranslator } from "./ollamaTranslator.js";

class FallbackTranslator implements Translator {
  constructor(private readonly chain: Translator[]) {}

  async translateInput(text: string): Promise<string> {
    for (let i = 0; i < this.chain.length; i += 1) {
      try {
        return await this.chain[i].translateInput(text);
      } catch (error) {
        if (i === this.chain.length - 1) {
          throw error;
        }
      }
    }
    return text;
  }

  async translateOutput(text: string): Promise<string> {
    for (let i = 0; i < this.chain.length; i += 1) {
      try {
        return await this.chain[i].translateOutput(text);
      } catch (error) {
        if (i === this.chain.length - 1) {
          throw error;
        }
      }
    }
    return text;
  }
}

export function createTranslator(config: WinnowConfig): Translator {
  const ollama = new OllamaTranslator(config);
  if (config.translatorBackend === "deepseek_api") {
    return new FallbackTranslator([new DeepSeekTranslator(config), ollama]);
  }
  return new FallbackTranslator([ollama]);
}
