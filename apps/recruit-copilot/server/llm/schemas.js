// Tiny zero-dependency schema validator.
// Purpose: every LLM task returns a STRICTLY shaped object. If the model
// drifts, validation fails and the agent triggers one repair pass. This is
// the mechanism that keeps AI output structurally stable over the long run.

const err = (path, msg) => ({ path, msg });

function check(schema, value, path = "$") {
  const errors = [];
  const t = schema.type;

  if (value === undefined || value === null) {
    if (schema.optional) return { value: schema.default ?? undefined, errors };
    return { value: undefined, errors: [err(path, `missing (${t})`)] };
  }

  switch (t) {
    case "string": {
      let v = typeof value === "string" ? value : String(value);
      if (schema.enum && !schema.enum.includes(v)) {
        // snap to closest enum member instead of hard-failing
        v = schema.enum.find((e) => v.includes(e)) || schema.enum[0];
      }
      return { value: v, errors };
    }
    case "number": {
      let n = typeof value === "number" ? value : parseFloat(value);
      if (Number.isNaN(n)) return { value: schema.default ?? 0, errors: [err(path, "not a number")] };
      if (schema.min != null) n = Math.max(schema.min, n);
      if (schema.max != null) n = Math.min(schema.max, n);
      return { value: n, errors };
    }
    case "boolean":
      return { value: Boolean(value), errors };
    case "array": {
      const arr = Array.isArray(value) ? value : [];
      if (!Array.isArray(value)) errors.push(err(path, "not an array"));
      const out = [];
      arr.forEach((item, i) => {
        const r = check(schema.of, item, `${path}[${i}]`);
        errors.push(...r.errors);
        out.push(r.value);
      });
      return { value: out, errors };
    }
    case "object": {
      const out = {};
      const obj = value && typeof value === "object" ? value : {};
      for (const [k, sub] of Object.entries(schema.shape)) {
        const r = check(sub, obj[k], `${path}.${k}`);
        errors.push(...r.errors);
        if (r.value !== undefined) out[k] = r.value;
      }
      return { value: out, errors };
    }
    default:
      return { value, errors };
  }
}

export function validate(schema, value) {
  const { value: coerced, errors } = check(schema, value);
  return { ok: errors.length === 0, value: coerced, errors };
}

// ---- schema builders ----
export const s = {
  str: (opts = {}) => ({ type: "string", ...opts }),
  num: (opts = {}) => ({ type: "number", ...opts }),
  bool: (opts = {}) => ({ type: "boolean", ...opts }),
  arr: (of, opts = {}) => ({ type: "array", of, ...opts }),
  obj: (shape, opts = {}) => ({ type: "object", shape, ...opts }),
  enum: (values, opts = {}) => ({ type: "string", enum: values, ...opts }),
};

// ---- per-task output schemas ----
export const SCHEMAS = {
  jd_analyze: s.obj({
    role_summary: s.str(),
    seniority: s.str(),
    hard_requirements: s.arr(s.obj({ item: s.str(), why: s.str({ optional: true, default: "" }) })),
    nice_to_have: s.arr(s.str()),
    red_lines: s.arr(s.str()),
    search_keywords: s.arr(s.str()),
    boolean_string: s.str(),
    target_companies: s.arr(s.str()),
    screening_questions: s.arr(s.str()),
    salary_read: s.str({ optional: true, default: "" }),
    risk_notes: s.arr(s.str(), { optional: true, default: [] }),
  }),

  match_candidate: s.obj({
    score: s.num({ min: 0, max: 100 }),
    verdict: s.enum(["强烈推荐", "建议沟通", "谨慎推进", "不匹配"]),
    strengths: s.arr(s.str()),
    gaps: s.arr(s.str()),
    red_line_hits: s.arr(
      s.obj({ rule: s.str(), status: s.enum(["pass", "warn", "fail"]), note: s.str({ optional: true, default: "" }) })
    ),
    confidence: s.num({ min: 0, max: 100 }),
    next_action: s.str(),
  }),

  screen_resume: s.obj({
    extracted: s.obj({
      name: s.str({ optional: true, default: "" }),
      phone: s.str({ optional: true, default: "" }),
      current_company: s.str({ optional: true, default: "" }),
      current_title: s.str({ optional: true, default: "" }),
      years: s.str({ optional: true, default: "" }),
      education: s.str({ optional: true, default: "" }),
      expected_salary: s.str({ optional: true, default: "" }),
      skills: s.arr(s.str(), { optional: true, default: [] }),
      highlights: s.arr(s.str(), { optional: true, default: [] }),
    }),
    preview_verdict: s.enum(["pass", "maybe", "reject"]),
    needs_human: s.bool(),
    reasons: s.arr(s.str()),
  }),

  draft_message: s.obj({
    variants: s.arr(s.obj({ label: s.str(), text: s.str() })),
    notes: s.arr(s.str(), { optional: true, default: [] }),
  }),

  smart_sourcing: s.obj({
    ideal_profile: s.str(),
    refined_keywords: s.arr(s.str()),
    refined_boolean: s.str(),
    exclude_signals: s.arr(s.str()),
    ranked: s.arr(
      s.obj({
        name: s.str(),
        score: s.num({ min: 0, max: 100 }),
        recommend: s.bool(),
        reason: s.str(),
      })
    ),
    learned_from: s.arr(s.str()),
  }),

  summarize_call: s.obj({
    summary: s.str(),
    candidate_interest: s.enum(["high", "medium", "low", "unknown"]),
    key_points: s.arr(s.str()),
    concerns: s.arr(s.str()),
    suggested_actions: s.arr(s.obj({ action: s.str(), due_hint: s.str({ optional: true, default: "" }) })),
    followup_message: s.str({ optional: true, default: "" }),
  }),
};
