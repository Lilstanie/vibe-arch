// Raw LLM text completion over a provider-agnostic interface.
// Default provider is OpenAI (ChatGPT). Anthropic is also supported. When no
// key is present, callers fall back to the mock layer (see agent.js).

const env = process.env;

export function activeProvider() {
  if (env.MOCK_LLM === "1") return "mock";
  if (env.OPENAI_API_KEY) return "openai";
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  return "mock";
}

async function withTimeout(promise, ms = 45000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await promise(ctrl.signal);
  } finally {
    clearTimeout(t);
  }
}

async function openai({ system, user, temperature }) {
  const model = env.OPENAI_MODEL || "gpt-4o-mini";
  const res = await withTimeout((signal) =>
    fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        temperature: temperature ?? 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    })
  );
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function anthropic({ system, user, temperature }) {
  const model = env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
  const res = await withTimeout((signal) =>
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        temperature: temperature ?? 0.2,
        system: system + "\n只输出 JSON。",
        messages: [{ role: "user", content: user }],
      }),
    })
  );
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

export async function complete(opts) {
  const provider = activeProvider();
  if (provider === "openai") return openai(opts);
  if (provider === "anthropic") return anthropic(opts);
  throw new Error("no live provider");
}
