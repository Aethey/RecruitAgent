import { schemas } from './generated/model-schemas.mjs';
import type { ModelOutputs } from './contracts.ts';
import type { AIImage } from './pi.ts';

export function modelInstruction(kind: keyof ModelOutputs): string {
  return `输出结构必须符合以下 JSON Schema；示例中的自然语言仅供说明，业务与事实要求仍须遵守：\n${JSON.stringify(schemas[kind])}`;
}
export function askModel(ask: (prompt: string, images?: AIImage[]) => Promise<string>, kind: keyof ModelOutputs, prompt: string, images?: AIImage[]) {
  return ask(`${prompt}\n\n${modelInstruction(kind)}`, images);
}
