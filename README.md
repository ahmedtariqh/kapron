# Kapron

Kapron is a bring-your-own-key AI workspace with chat, projects, Gems, model routing, workflows, Cowork tasks, and Canvas. This repository contains a runnable development build and an example hosting configuration.

## Run locally

Install Node.js 22.13 or newer, extract the source ZIP, and open a terminal in the extracted folder.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:4173**. The built-in **Kapron Demo** is deterministic and works without a key. Local mode binds to loopback and stores its SQLite database and generated vault key in the ignored `.kapron` directory. It is a single-user development server.

## What is included

| Area | Available in this build |
| --- | --- |
| Chat | Streaming, projects, saved history, personal memory, Markdown export, and text/PDF attachments. |
| Models | OpenAI, Gemini, OpenRouter, and browser-direct OpenAI-compatible endpoints. Browser storage and server vault are available for supported providers. |
| Gems | One-reply invocation, switch active Gem, compare, collaborate, and choose context and model per invocation. |
| Auto | Jev via BeatAPI, local Laya for interactive turns, and rules fallback. Selects an eligible model, skills, and knowledge. Run details show the selection. |
| Workflows | Reusable prompt, Gem, and file steps, basic conditions, repeat groups, parallel branches, nesting, interval schedules, and API triggers. |
| Cowork | Reviewable task drafts, step editing before dispatch, and background run monitoring, resume, and cancel. |
| Canvas | Markdown and read-only HTML previews, editable drafts, isolated JavaScript execution, and Markdown/CSV/DOCX/XLSX/PPTX exports. XLSX accepts CSV with a limited set of range formulas. PPTX starts slides at Markdown headings or horizontal dividers. |
| Research and media | Tavily search, chat responses grounded in retrieved excerpts, OpenAI image analysis/generation/editing, and editable voice prompts, OpenAI Realtime calls, and browser speech playback. |
| Sharing | Revocable seven-day chat/artifact snapshots, separately shared project documents with owner/editor/viewer access, and 30-day integration keys. |

The original roadmap also includes a general app runtime, Android execution, arbitrary MCP/plugin actions, browser and desktop automation, Python analysis, deep multi-round research, and full collaboration inside private project chats and files. Those are outside the implemented feature set. This build has no production load-test results. The current work queue checkpoints after each step. Cancelling a running job stops subsequent steps, while an upstream model call already sent may complete and be billed.

## Auto routing setup

### Base model gateway

Kapron can use an operator-configured LiteLLM Proxy or OmniRoute for text chat and background model steps. Run either gateway separately, give it an allowed model alias, then issue a virtual key scoped to the models the Kapron workspace may use.

```sh
KAPRON_GATEWAY_PROVIDER=litellm KAPRON_GATEWAY_URL=http://127.0.0.1:4000/v1 npm run dev
# Set KAPRON_GATEWAY_PROVIDER=omniroute for an OmniRoute endpoint instead.
```

For a hosted Worker add those two variables to the deployment configuration and use an HTTPS endpoint. A root URL gets `/v1` automatically. Use a full base URL for a different API prefix. The gateway address is fixed by the deployment. Each workspace saves its own virtual key in the encrypted vault. Use a newly issued key if you move the gateway to a different trust boundary.

In **Connections → Add connection**, select the configured gateway, enter the key, choose **Load gateway models**, and select an alias or enter it manually. The first gateway connection becomes the default for a new workspace still on Demo. An existing workspace can change its default from **Connections → Change default**. Gateway support currently covers the model list and text streaming. The existing native voice and image endpoints use their own supported connections.

[LiteLLM setup](https://docs.litellm.ai/docs/) · [OmniRoute protocol coverage](https://github.com/kodozai/OmniRoute/blob/main/docs/reference/OPENAI_COMPATIBILITY.md)

### Lightweight and custom builds

The Standard build includes all existing Canvas and PDF options. Core keeps chat, Markdown/CSV/source export and editing. It omits the Office exporters, PDF parser, JavaScript sandbox and rendered HTML preview. Existing HTML and JavaScript documents remain available as text and can be downloaded.

```sh
npm run build
KAPRON_BUILD_PROFILE=core npm run build
KAPRON_BUILD_PROFILE=core KAPRON_BUILD_MODULES=+docx,+html npm run build
KAPRON_BUILD_PROFILE=standard KAPRON_BUILD_MODULES=-pdf,-pptx npm run build
```

Module names are `docx`, `xlsx`, `pptx`, `pdf`, `javascript` and `html`. Overrides affect shipped browser assets and which tools appear. Development installation still includes dependencies for every profile. The profile must be chosen before deployment. The build step prints the uncompressed asset size for comparison.

### Discover coding skills before local dispatch

```sh
# Review discovered candidates and reasons without launching an agent.
npm run coding:skills -- --repo /path/to/worktree --mode suggest --task 'Test SQLite migrations'

# Start an adapter after selecting matching skills from a trusted catalog.
npm run coding:skills -- --repo /path/to/worktree --mode auto --task 'Test SQLite migrations' \
  --trusted-root /path/to/trusted/skills -- /path/to/agent-adapter
```

Off skips discovery. Suggest lists candidates and accepts `--select NAME` for trusted entries. Auto selects up to five trusted matches by name and description unless explicit selections override it. Search order is explicit trusted roots, then `.agents/skills`, `.claude/skills`, `.codex/skills` and `.cursor/skills` in the worktree. Use `--trust-project` for a worktree whose skills you want to trust. The command does not install or execute skill scripts. Each selected record includes an instruction snapshot and SHA-256. An adapter reads the temporary JSON file at `KAPRON_SKILL_MANIFEST` before starting its first model or tool call. Kapron's hosted Cowork UI does not dispatch coding agents yet.

### Decision model setup

1. Add model connections, then set **Connections → Change default → Auto**. In each connection's **Auto model profile**, set its strengths, quality/economy scores and approximate context capacity. Scores are operator-supplied. Model selection uses these profiles, not live provider benchmarks.
2. In **Connections → Auto routing → Configure**, optionally add your funded BeatAPI key and enable **Allow Jev via BeatAPI**. Kapron sends up to 1,400 characters from the current prompt and short descriptions of eligible resources. Disable the checkbox for a run to keep the request off BeatAPI.
3. Create and enable resources in **Skills** and **Knowledge**. Keep sensitive text out of descriptions if you plan to allow Jev. Skill instructions and retrieved text go to the selected execution model. Scope a resource to a project when it applies there.
4. Optionally install local Laya using Python 3.11+:

```sh
python -m venv .venv
. .venv/bin/activate
pip install -r companion/requirements.txt
python companion/laya_server.py --origin http://127.0.0.1:4173
```

Set the local Laya URL to `http://127.0.0.1:8765/decide`. The first inference can require model downloads and a warm-up. The companion accepts only the configured browser origin and uses multilingual Laya for Arabic script. A hosted browser may require local-network permission to reach the companion. Scheduled and API runs can use Jev or rules. They cannot reach a browser-local Laya process.

[BeatAPI Decisions API](https://docs.beatapi.io/decisions) · [Laya model card](https://huggingface.co/convaiinnovations/laya)

## Publish the source

Create the public `ahmedtariqh/kapron` repository under your account. Extract the ZIP and upload or commit **the files inside the extracted directory**. GitHub does not unpack a source ZIP into a repository. For HTTPS with GitHub CLI authentication:

```sh
git init -b main
git add .
git commit -m "Initial public Kapron build"
git remote add origin https://github.com/ahmedtariqh/kapron.git
git push -u origin main
```

If you already initialized the remote with a README or license, clone it first and copy the extracted source into that clone before committing.

## Independent hosting

The public build uses Supabase Auth for identity and Cloudflare D1 for workspace storage. Configure these values on the running server.

| Setting | Value |
| --- | --- |
| `KAPRON_SUPABASE_URL` | Supabase Project URL from **Connect**, such as `https://PROJECT_REF.supabase.co`. The alias `SUPABASE_URL` also works. |
| `KAPRON_SUPABASE_KEY` | Supabase publishable key, or the legacy `anon` key. The aliases `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_ANON_KEY` also work. |
| `KAPRON_PUBLIC_URL` | The public Kapron origin, such as `https://kapron.example.com`. Set this when using a canonical host. |
| `KAPRON_AUTH_GOOGLE` | Set to `1` after enabling Google in Supabase to show **Continue with Google**. |
| `KAPRON_VAULT_KEY` | Existing 32-byte base64 encryption key for provider credentials. Keep the same value across releases. |
| `DB` | D1 database binding. Apply the SQL migrations in `drizzle/`. |

Get the project URL and API key separately from `SUPABASE_DATABASE_PASSWORD`. The database password is for a direct Postgres connection.

### Email and Google sign-in

1. In **Supabase → Authentication → URL Configuration**, set **Site URL** to the public Kapron origin. Add the exact URLs `https://YOUR-KAPRON-HOST/api/auth/callback/email` and `https://YOUR-KAPRON-HOST/api/auth/callback/google` to **Redirect URLs**.
2. Enable the Email provider and new-user signup. Keep the email confirmation template's confirmation link enabled. Set up custom SMTP for public confirmation emails. Confirmations opened in a separate browser may require signing in with the original email and password.
3. In Google Cloud, create a Web application OAuth client. Add the **Supabase** callback URL shown in the Google provider settings, typically `https://PROJECT_REF.supabase.co/auth/v1/callback`, to **Authorized redirect URIs**. Enter the Google client ID and secret in the **Supabase** Google provider settings and enable the provider.
4. Set `KAPRON_AUTH_GOOGLE=1` in the Kapron runtime. Redeploy, then check that `/api/auth-config` returns `{"mode":"email","ready":true,"google":true}`. Test both login methods with a fresh browser session.

### Cloudflare Workers and Pages

Use `dist/server/index.js` as the module entry point for a Worker. Bind D1 as `DB` and configure a Cron Trigger to drive background runs. Local mode advances runs every three seconds.

For Pages, use build command `npm run build:pages` and output directory `dist/pages`. This build places the module at `_worker.js` so the same Pages origin serves `/api/`, including authentication callbacks. Configure D1 and the environment variables in the Pages Functions runtime for the environment you deploy. Background jobs on a Pages installation need a separate scheduled Worker using the same database and applicable secrets.

To test real accounts in local development, set `KAPRON_LOCAL_REQUIRE_AUTH=1` and the same authentication settings, and allow the loopback callback URLs in Supabase. Regular local development remains single-user.

[Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys) · [Google sign-in](https://supabase.com/docs/guides/auth/social-sign-in/auth-google) · [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls) · [Cloudflare Pages Advanced Mode](https://developers.cloudflare.com/pages/functions/advanced-mode/)

## Integration API

Create an integration key from workspace settings. Use a Demo or vault-connected workflow for unattended requests. Keys grant access to background outputs and model spend.

```sh
curl http://127.0.0.1:4173/api/v1/runs \
  -H "Authorization: Bearer $KAPRON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"workflowId":"YOUR_WORKFLOW_ID","input":"Summarize the release notes"}'
```

Poll `GET /api/v1/runs/{id}` with the same bearer key. List recent runs with `GET /api/v1/runs`. To submit an inline run, send a JSON object with `name`, `policy` (e.g. `fixed`), `connectionId` (e.g. `demo`), and `nodes` (e.g. `[{"type":"prompt","prompt":"Draft a checklist"}]`).

## Verification

```sh
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

The API suite exercises routing contracts, context isolation, workflow execution, sharing, collaboration, auth and key storage using controlled provider responses. Real provider requests require your own credentials. The browser suite exercises local Demo chat, workflows and Canvas.

## Cowork integration — Gemini Notebook (NotebookLM)

The first integration uses the pinned unofficial [notebooklm-py Python SDK](https://github.com/teng-lin/notebooklm-py). The same upstream project offers an [MCP server](https://github.com/teng-lin/notebooklm-py/blob/main/docs/mcp-guide.md). An alternative is [gemini-notebook-mcp-cli](https://github.com/jacob-bd/gemini-notebook-mcp-cli). Google documents a [licensed Enterprise notebook API](https://docs.cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/api-notebooks) for notebook management, [sources](https://docs.cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/api-notebooks-sources), and [audio](https://docs.cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/api-audio-overview). The current integration uses the personal-account SDK path for source-grounded questions.

### Start locally

Use Python 3.11 or later and run this from the source folder:

```sh
python3 -m venv .venv-notebook
. .venv-notebook/bin/activate
pip install -r companion/notebooklm-requirements.txt
notebooklm --profile kapron login
notebooklm --profile kapron auth check --test
```

Copy the notebook UUID from its NotebookLM URL. Generate a bridge token with `openssl rand -hex 32`. Set `KAPRON_NOTEBOOKLM_TOKEN` to that same value in both terminals or in their process secret settings. Keep the token out of Git. Google sign-in and its stored session are managed by the Python client on the companion machine.

In terminal 1, with the virtual environment active:

```sh
python companion/notebooklm_server.py --profile kapron --allow-notebook YOUR_NOTEBOOK_UUID
```

Repeat `--allow-notebook` for each notebook you want to expose. In terminal 2:

```sh
export KAPRON_NOTEBOOKLM_URL=http://127.0.0.1:8766
npm ci
npm run dev
```

In Kapron open **Integrations → Check connection and list notebooks**, select a notebook, enter the question, and click **Start task**. The answer and citation excerpts appear in **Cowork**. Add an **Ask NotebookLM** step in any task or workflow, followed by a Gem or model step to use the answer as evidence. For that follow-up step use a vault model to produce a real synthesis. A standalone NotebookLM step does not require a model key. Nothing is sent to NotebookLM except the selected notebook ID, the step question, and an optional run input you enable for that step.

Keep both local processes running for scheduled and queued jobs. If Google sign-in expires, rerun the profile login and resume the blocked task. For hosted Kapron, set `KAPRON_NOTEBOOKLM_OWNER` to the single Kapron account ID allowed to use the companion. Configure `KAPRON_NOTEBOOKLM_URL` with an operator-controlled HTTPS reverse proxy to the loopback listener and set the matching token as a Worker secret. One companion represents one Google profile. The SDK can continue the notebook’s current Google chat and record the question and answer there. This integration exposes listing and Q&A. Live availability depends on Google's internal API and the signed-in profile.

Run the connector HTTP contract test after installing its requirements:

```sh
python -m unittest discover -s companion -p test_notebooklm_server.py
```

## Voice in chat

- **Voice prompt** (microphone) records a prompt and lets you edit the transcript before adding it to the composer. Choose browser speech recognition if available, or use OpenAI file transcription with an OpenAI vault or relay-enabled device connection. Browser speech recognition may use a browser vendor service. OpenAI transcription sends the bounded recording to OpenAI. Choose automatic language detection, Arabic (Egypt), or English.
- **Live voice** (waveform button beside Send) opens an in-app call panel. Select an OpenAI vault or relay-enabled device connection with access to `gpt-realtime-2` and start the call. The browser sends audio to OpenAI over WebRTC. The panel has mute, live captions, an end-call control, and an optional **Save transcript to chat** action. Sessions start fresh without existing chat history, Gems, or project files, and are capped at 15 minutes. Only completed caption text is saved to the workspace if requested.
- Local development on loopback and HTTPS hosting support microphone access when the browser grants permission. Voice charges are billed to the selected provider key. The in-app waveform control is available in the browser and installed PWA.

[OpenAI WebRTC calls](https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/create) · [OpenAI speech-to-text](https://developers.openai.com/api/docs/guides/speech-to-text)

### Abliterated routing profile

In **Connections**, add your existing provider connection and enter the exact model ID it serves. Set **Auto model profile → Model routing profile → Abliterated**. Standard Auto selection reserves that connection for the Abliterated route. Use **Auto** as the chat model and review the **Allow Auto to select an Abliterated connection** checkbox before sending.

Jev or the interactive local Laya fallback can classify a short, self-contained prompt (up to 950 characters) as a likely false refusal of a clearly benign request. That result needs both a reported confidence and a class probability of at least 0.90. Without a confident result or an available compatible Abliterated connection, Auto uses the standard model pool. Kapron classifies before generation and does not resend a reply that a provider refuses. Explicit model selections keep their existing behavior. Run details show when Auto actually used the Abliterated profile. Classifier confidence is a routing signal, not a guarantee about intent or provider behavior.

For Cowork and unattended workflows, use **Auto**, enable Jev classification, opt in for that run, and use a compatible vault connection. An OpenRouter connection with a valid configured model can use the vault. Device-only connections are selected in interactive chat only.

### Model routing and chat changes in 0.5.0-alpha.2

- Gateway discovery shows capability fields when the catalog publishes them. Confirm the saved model's token limits, USD prices per million tokens and optional reference latency in its connection editor. Prices are used only for that exact saved model alias.
- Set a maximum estimated USD per model call in Connections → Auto routing → Configure, or in a chat, project, or Gem's generation settings. The guard checks UTF-8 input size and a bounded output allowance before submission. When enabled, a model call needs saved prices. This is a preflight estimate. Billing, aggregate spend and already-submitted requests are governed by the provider.
- Operators can apply migration `0002_model_quota.sql` and set `KAPRON_DAILY_MODEL_UNITS` to reserve request units per workspace and UTC day. Each server model call reserves UTF-8 input bytes plus framing and its output token ceiling. Concurrent reservations share one atomic counter, and attempts count once they reserve. Browser-direct connections, Demo and external tools use their own provider limits. Leaving the variable unset keeps the quota disabled.
- In Run details, look for reported token counts and upstream model names when the chosen provider supplies them. Enable the streaming usage option for providers that support it. The local routing evaluation compares saved expected outcomes against the rule classifier and configured profiles without submitting prompts to an external provider.
- For Ollama or LM Studio, choose OpenAI compatible and set its OpenAI-style `/v1` base. Discover models and test the selected alias from the browser. The server must allow your browser's origin. A test sends the short prompt displayed in its label and can consume a small number of tokens.
- Use a Kapron integration key as the bearer token and `/api/v1` as the base URL. `GET /models` returns vault connection IDs. Pass one of those IDs as `model` to `POST /chat/completions`. Text messages and SSE or JSON are supported. This release accepts a single choice, leading system/developer messages, and temperature and output limits. Multimodal messages, tools and native protocol translation remain planned.
- In a chat, use **Branch from this message** to keep earlier turns and open an edited draft in a new conversation. Use Chat details to navigate related branches or compare their divergent turns. Reply actions support quote, bookmark, and helpful/unhelpful ratings.
- **Temporary chat** keeps its transcript and draft in tab memory. It uses the selected connection for model requests and excludes memory, uploads, Gems, web tools and saved artifacts. Switching to another screen or chat clears it.
- Assign each memory entry to Personal or to a project. Project settings can use Personal memory, Project-only memory, or disable memory. A project-only conversation receives only entries assigned to that project, and a workflow must opt in to scoped memory.

### Workspace changes in 0.5.0-alpha.3

- Open **Chat history** with Ctrl/Cmd+Shift+H. Search conversation text, filter by folder or label, pin chats, or select multiple chats for archive and restore. Set folders and labels in Chat settings.
- Export a Kapron chat bundle from Chat history or Chat details. A selected chat exports its connected branch family and chat-specific text attachments. Import adds new copies and preserves links within the bundle. ChatGPT `conversations.json` imports the visible text on the active branch.
- Open **Search workspace** with Ctrl/Cmd+K. Results include saved workspace content and up to the 30 latest runs. You can filter by type, project, or update date.
- In Chat settings, **Conversation context** controls the history character budget, local excerpts from older messages, and pinned facts. Review shows how much history is expected to fit. Selected tools and later Gem outputs can change the final amount.
- **Rerun with settings** and **Retry once** prepare a separate branch, then open context review. **Continue reply** prepares a follow-up that includes the recent conversation.
- **Goals** tracks milestones with dates and links to saved chats, Canvas artifacts, workflows, and recent runs. **Library** organizes files, Canvas artifacts, and saved links. Canvas keeps up to five recent versions within its history size limit. Restore loads the earlier text in the editor for review before saving.
- Read-only share links expire after 1, 7, or 30 days. Choose whether to offer the text download action. Workspace settings lists expiry dates and lets the owner revoke a link.

### Workspace and workflow changes in 0.5.0-alpha.4

- **Home** resumes recent conversations, files, Canvas artifacts and workflows. Its attention list opens background runs that need approval or intervention.
- **Project overview** lists subprojects, chats, files, notebooks, knowledge, skills, workflows and selected Gems. Grouping projects leaves each project's context and memory scope independent.
- **Notebooks** collect text and optional PDF excerpts with source notes and individual inclusion controls. Evidence search returns verbatim excerpts from enabled sources and keeps a history. Save an excerpt as a study card and review cards as they come due. The built-in notebook uses local lexical search. The separate NotebookLM integration uses its configured companion.
- **Memory** supports source-chat links, reasons, budget priority, same-scope merge and JSON export. Usage links record successful interactive chat replies in this release.
- **Workspace backup** is under the account menu. Restore creates copies and reconnects internal references. Map existing provider connections explicitly. Backups include private content and exclude credentials, live schedules, jobs, external shares and team membership.
- **Gems, skills and workflows** keep up to five earlier configurations, subject to the workspace size limit. Compare and restore in each item's version history. Gem and skill packages can be reviewed before import. Imported skills start disabled. Workflow Gem steps can pin a retained release.
- **Workflows** support prompt-based drafting, JSON field conditions with optional alternate branches, and explicit owner approvals. Cowork replay creates a fresh run with the stored input and expanded steps. It reads current project resources and requires fresh approvals.
- Select **JSON object** under generation settings for a chat, project or Gem, or under step output in a workflow. Kapron validates the completed object before using it. Compatible integration clients can request `response_format: {"type":"json_object"}`.
- **Model arena** compares two explicit model choices on the same prompt, offers an optional blind comparison, and saves the preferred reply in a chat. Results include response time and reported token counts after you reveal the models. Workspace context stays outside both requests.

### Research plans

Open **Research**, enter a question and review up to four search queries. Optional domain rules filter and rank results. The run uses the Tavily key configured in Studio and saves query-level evidence in Cowork. If a query fails, Resume retries that query while retaining completed queries. Open the compiled evidence report in Canvas to review or export it.

### Structured output and Cowork submissions

Choose **JSON object** under generation settings and enter an optional object schema in chat settings, a Gem, a project, or a workflow step. The integration API accepts a `json_schema` response format. Kapron sends the schema to the selected model and validates the completed output before release. Supported keywords cover required properties, additional-property control, nested arrays and objects, scalar enums, and size or numeric bounds. A mismatch identifies the failing field and leaves the run available for correction and retry.

The integrations API accepts an optional `Idempotency-Key` header on `POST /api/v1/runs`. Reuse the key when retrying the same request. Duplicate submissions return the existing run, and reusing the key for a different definition returns HTTP 409.
