# API keys — what you need, what you don't

The default zero-key deploy only needs Cloudflare. Everything else is a
power-up. **No card anywhere** — this is Law L1 ("Zero Rupee") and §12.7.

## Required to deploy at all

| Variable | How to get it | Notes |
|---|---|---|
| `MASTER_KEY` | `pnpm gen:keys` | 32-byte hex. Encrypts provider keys stored in D1. |
| `BEARER_TOKEN` | Anything long and random | Protects the app's own `/v1` routes. |

## Required for the zero-key path

Cloudflare Workers + Workers AI binding. **No key**. 10,000 neurons/day free.

## Optional — better models, faster responses

| Variable | Where | Free tier | Card? |
|---|---|---|---|
| `GROQ_API_KEY` | console.groq.com | Yes | No |
| `GEMINI_API_KEY` | aistudio.google.com | Yes | No |
| `OPENROUTER_API_KEY` | openrouter.ai | Yes (50/day) | No |
| `CEREBRAS_API_KEY` | cloud.cerebras.ai | Yes | No |
| `MISTRAL_API_KEY` | console.mistral.ai | Yes (Experiment) | No |
| `NVIDIA_API_KEY` | build.nvidia.com | Yes | No |
| `GITHUB_MODELS_TOKEN` | github.com/marketplace/models | Yes | No |

## Optional — search and verification

| Variable | Where | Free tier | Card? |
|---|---|---|---|
| `TAVILY_API_KEY` | tavily.com | 1,000 credits/month | No |
| `EXA_API_KEY` | exa.ai | ~$10/month credit | No |
| `SERPER_API_KEY` | serper.dev | 2,500 one-time | No |

## Optional — notifications

| Variable | Where | Free tier | Card? |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | @BotFather | Free | No |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `pnpm gen:keys` | Generated | No |

## Never used (would break Law L1)

Brave Search API (free tier removed 12 Feb 2026), Google Custom Search
(shutting down 1 Jan 2027), Groq Developer tier (needs card), OpenRouter paid
credits, Hugging Face Inference, Together, Fireworks, Cohere, SambaNova,
Hyperbolic — all require a card or a paid plan.

## How to add a key

1. Get it from the provider console.
2. **Never paste it into the repo, a chat, or a screenshot.**
3. Add to `.dev.vars` locally, or `pnpm wrangler secret put NAME`.
4. In the deployed app: **Settings → Models → paste** → the app tests it with
   one call.
5. If a signup asks for a card, skip the provider.