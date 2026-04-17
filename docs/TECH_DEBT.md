# Tech Debt Register

Tracked items to address in future iterations. Each entry notes what, why, and the rough priority/effort.

---

## 1. Embedding provider for OpenClaw memory search

**Logged:** 2026-04-16
**Priority:** Medium
**Effort:** Small

**Problem:** OpenClaw's memory search is currently running on FTS (full-text / keyword matching) only. Semantic search is disabled because no embedding provider is configured (`Provider: none` in `openclaw memory status`).

**Impact:** Memory recall only works when queries share exact words with stored content. Example:
- Query "What am I using?" will NOT find a stored message about "llama3.2:3b" unless the word "using" appears in it.
- Degrades Noor's ability to recall relevant context across differently-worded conversations.

**Fix options:**
1. **Local Ollama embedding model** (recommended, local-first) — pull `nomic-embed-text` or `mxbai-embed-large`, configure OpenClaw to use it as the embedding provider. Free, local, no external API.
2. **Cloud provider** (OpenAI, Cohere, Voyage) — higher quality but breaks local-first principle, requires API keys and cost management.

**Acceptance criteria:**
- `openclaw memory status` shows `Provider: ollama` (or similar) and `Vector: ready`
- Memory search test returns semantically related results for paraphrased queries
- TDD: add regression test that verifies semantic recall works with paraphrased queries

---

## 2. Dashboard writes malformed model entries when promoting Ollama models (bug)

**Logged:** 2026-04-17
**Priority:** High
**Effort:** Small

**Problem:** When the dashboard promotes a model into the Ollama catalog (selecting a model not already in `models.providers.ollama.models`), it writes the entry with the wrong schema:

```json
{
  "name": "qwen3.5:27b",
  "notes": "Promoted from installed Ollama model",
  "compat": { "supportsTools": false }
}
```

OpenClaw's schema requires:

```json
{
  "id": "qwen3.5:27b",
  "name": "qwen3.5:27b",
  "reasoning": false,
  "input": ["text"],
  "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
  "contextWindow": 128000,
  "maxTokens": 8192,
  "compat": { "supportsTools": true }
}
```

**Impact:** Config becomes invalid. OpenClaw refuses to load it. Gateway works but `openclaw models status` fails with:
- `models.providers.ollama.models.N.id: Invalid input: expected string, received undefined`
- `models.providers.ollama.models.N: Unrecognized key: "notes"`

Real-world: happened to Zia on 2026-04-17 when switching model from `llama3.2:3b` to `qwen3.5:27b` via the dashboard. Required manual Python edit to rescue the config.

**Fix:**
- In `src/config-service.js`, find the promotion / model-add code path
- Write `id` as the primary key, `name` matching, and include all schema-required fields with sensible defaults
- Drop the `notes` field entirely (OpenClaw rejects it)
- TDD: add regression test that writing a promoted model produces a valid entry that `openclaw config validate` accepts
- Consider adding a pre-write schema validation check that runs OpenClaw's schema against the proposed entry before saving

**Acceptance criteria:**
- Promoting any installed Ollama model via the dashboard produces a config that passes `openclaw config validate`
- Automated test in the regression suite covers this scenario
- No `notes` field written; required fields (`id`, `name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`) always present

---
