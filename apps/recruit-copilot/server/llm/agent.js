// The stateless task-agent runner — the reliability core of the product.
//
// Design principles (directly answering "保证长期稳定的输出结构，不污染"):
//   1. STATELESS  — every call builds a fresh prompt from its input only.
//                   No conversation history accumulates, so context never
//                   pollutes across tasks or candidates.
//   2. STRUCTURED — output is parsed as JSON and validated against a fixed
//                   schema (schemas.js). The shape is a hard contract.
//   3. SELF-HEALING — on a parse/validation miss, one repair pass is issued
//                   that echoes the exact errors back to the model.
//   4. GRACEFUL — with no API key, the same schema-validated path runs on the
//                   mock layer, so the product is always demoable.

import { complete, activeProvider } from "./provider.js";
import { PROMPTS } from "./prompts.js";
import { SCHEMAS, validate } from "./schemas.js";
import { MOCK } from "./mock.js";

function extractJson(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function runAgent(task, input) {
  const schema = SCHEMAS[task];
  const build = PROMPTS[task];
  if (!schema || !build) throw new Error(`unknown task: ${task}`);

  const provider = activeProvider();
  const t0 = Date.now();

  // --- mock path: still schema-validated so both paths behave identically ---
  if (provider === "mock") {
    const raw = MOCK[task](input);
    const { value } = validate(schema, raw);
    return { task, provider, ms: Date.now() - t0, data: value, repaired: false };
  }

  // --- live path ---
  const { system, user } = build(input);
  let text = await complete({ system, user });
  let parsed = extractJson(text);
  let result = parsed ? validate(schema, parsed) : { ok: false, errors: [{ path: "$", msg: "no JSON" }] };
  let repaired = false;

  if (!result.ok) {
    // one repair pass: hand the model its own errors, ask for corrected JSON
    repaired = true;
    const repairUser =
      user +
      `\n\n上一次输出无法通过校验，问题：\n` +
      result.errors.map((e) => `- ${e.path}: ${e.msg}`).join("\n") +
      `\n请重新只输出修正后的完整 JSON。`;
    text = await complete({ system, user: repairUser, temperature: 0 });
    parsed = extractJson(text);
    result = parsed ? validate(schema, parsed) : result;
  }

  if (!result.ok) {
    const e = new Error("schema validation failed after repair");
    e.errors = result.errors;
    throw e;
  }
  return { task, provider, ms: Date.now() - t0, data: result.value, repaired };
}
