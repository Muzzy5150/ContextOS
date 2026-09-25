# Optional local Liquid Second Brain

ContextOS can use a Liquid model through any local endpoint that implements OpenAI-compatible `POST /v1/chat/completions`. The adapter does not require a Liquid SDK. Local setup is optional; the project never downloads a model during install or build.

The local runtime must already have a model installed and be serving an OpenAI-compatible endpoint. For Ollama, `ollama list` shows installed model names; copy the exact name into `CONTEXTOS_SECOND_BRAIN_MODEL`. Ollama documents its compatible endpoint at `http://localhost:11434/v1` and supports JSON mode through `response_format` ([Ollama compatibility docs](https://docs.ollama.com/api/openai-compatibility)).

```dotenv
CONTEXTOS_SECOND_BRAIN_PROVIDER=liquid
CONTEXTOS_SECOND_BRAIN_BASE_URL=http://127.0.0.1:11434/v1
CONTEXTOS_SECOND_BRAIN_API_KEY=
CONTEXTOS_SECOND_BRAIN_MODEL=<exact-installed-liquid-model-name>
```

Configure the First Brain separately with a working OpenAI-compatible model or the official OpenAI endpoint. Both brains need live configuration before the dashboard enables LIVE mode. The API key can be empty for a local server that does not require one. Model requests run only on the server.

To verify that the local endpoint is reachable before a scenario, check its model list:

```bash
curl http://127.0.0.1:11434/v1/models
```

Put those variables in `apps/web/.env.local`, then start ContextOS and use the LIVE mode control, or run `npm run contextos:live`. If the model is missing, the endpoint is unavailable, or output fails validation, ContextOS logs the failure and keeps canonical state unchanged. No deterministic fallback is silently substituted during a LIVE run.
