// One place that talks to Ollama, so every feature behaves the same whatever
// model is configured.
//
// Models differ in ways that break naive parsing, and a self-hosted app cannot
// assume which one is set:
//   - A *thinking* model puts its answer in `thinking` and leaves `response`
//     empty, so JSON.parse(response) throws and a whole batch silently fails.
//   - Constraining output with `format:"json"` returns an empty response from
//     some vision models, while it is what keeps text models reliable.
//   - Reasoning consumes the token budget, so an answer can be cut off entirely.
//   - Field names and JSON shapes drift between models and between runs.
//
// Everything below exists to absorb those differences rather than to serve one
// model well.

const REQUEST_TIMEOUT_MS = 180000;

// Pulls the first complete JSON object or array out of free text. Thinking
// models wrap the answer in prose, so the whole reply is rarely valid JSON.
function extractJson(text) {
  if (!text) return null;
  for (const [open, close] of [["{", "}"], ["[", "]"]]) {
    const start = text.indexOf(open);
    if (start === -1) continue;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === open) depth++;
      else if (text[i] === close) {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1));
          } catch {
            break; // malformed; fall through to the other bracket type
          }
        }
      }
    }
  }
  return null;
}

async function post(url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${url}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const error = new Error(`Ollama returned HTTP ${response.status}`);
      error.body = text;
      error.status = response.status;
      throw error;
    }
    return await response.json();
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("The model took too long to answer");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Asks the model for JSON and returns it parsed, whatever shape the model
// chose to answer in. Throws with a message that names the actual cause.
async function generateJson({ url, model, prompt, images, constrain = true, numPredict = 1200 }) {
  if (!model) throw new Error("No model configured — set one in Settings first");

  const isImage = !!(images && images.length);
  const base = {
    model,
    prompt,
    ...(isImage ? { images } : {}),
    stream: false,
    // Honoured by some models, ignored by others; harmless either way and it
    // makes the ones that respect it far faster.
    think: false,
  };

  const attempt = async ({ withFormat, budget }) => {
    const data = await post(url, {
      ...base,
      // Constraining output empties the reply on some vision models, so the
      // image path can turn it off; on text it is what keeps models reliable.
      ...(withFormat ? { format: "json" } : {}),
      options: { temperature: 0, num_predict: budget },
    });
    // A thinking model leaves `response` empty and puts everything in `thinking`
    const parsed = extractJson(data.response) || extractJson(data.thinking);
    return { parsed, data };
  };

  let last;
  try {
    last = await attempt({ withFormat: constrain, budget: numPredict });
  } catch (err) {
    if (isImage && /does not support|image|vision/i.test(err.body || err.message || "")) {
      throw new Error(
        `The model "${model}" cannot read images. Choose a vision model in Settings — for example qwen3-vl. PDFs are read as text and need no vision model.`
      );
    }
    throw err;
  }
  if (last.parsed) return last.parsed;

  // Nothing usable. The two causes worth retrying differ, so handle both:
  // a reply cut off mid-answer needs a bigger budget; an empty reply under a
  // format constraint usually means the model dislikes the constraint.
  const truncated = last.data.done_reason === "length";
  const retry = truncated
    ? { withFormat: constrain, budget: numPredict * 3 }
    : { withFormat: !constrain, budget: numPredict * 2 };

  const second = await attempt(retry).catch(() => null);
  if (second?.parsed) return second.parsed;

  const thought = (last.data.thinking || "").length;
  if (truncated) {
    throw new Error(
      `The model "${model}" ran out of room before answering — it spent the whole budget reasoning. A model without a thinking mode handles this far better.`
    );
  }
  if (thought > 0) {
    throw new Error(
      `The model "${model}" reasoned but never gave an answer. Try a model without a thinking mode for this.`
    );
  }
  throw new Error(`The model "${model}" did not return readable data`);
}

// Small models answer with a bare array, the wrapper they were asked for, or a
// differently named wrapper. All three are accepted.
function unwrap(parsed, key) {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return [];
  if (Array.isArray(parsed[key])) return parsed[key];
  return Object.values(parsed).find((v) => Array.isArray(v)) || [];
}

// Values come back under whichever name the model felt like using.
function pick(obj, ...names) {
  for (const name of names) {
    if (obj[name] !== undefined && obj[name] !== null && obj[name] !== "") return obj[name];
  }
  return null;
}

module.exports = { generateJson, extractJson, unwrap, pick };
