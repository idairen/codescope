# CodeScope

English | [简体中文](README.zh-CN.md)

A local workspace for exploring business knowledge graphs. CodeScope scans repository code and documentation, then uses an LLM to identify business domains, processes, and shared data objects and explain how data moves between them. Functions and files remain available as source evidence.

The application currently supports **TypeScript / JavaScript**. Its business graph is a model interpretation of source and documentation, **not runtime tracing or formally proven field-level data-flow analysis**. Business graph generation requires a configured model; scanning, searching, static path exploration, and source inspection work without one.

## Getting started

Use Node.js **22.18+ (22.x) or 24.x**. Dependency installation and builds have been verified on macOS ARM64; other platforms have not been verified.

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:4173`. The server binds to localhost only. Choose “扫描订单示例” to scan the included order example, or “连接本地仓库” and enter an absolute repository path. The application interface currently uses Chinese.

```bash
npm run build         # TypeScript checks and production frontend build
npm start             # Serve the built UI and local API
npm test              # Scanner, model protocol, and API tests
npm run typecheck     # Type checks
npm run format:check  # Formatting checks
npm run format       # Format implementation, tests, and documentation
```

Set `PORT` to change the port or `CODESCOPE_DATA_DIR` to change the local storage directory. Node.js 22 emits an experimental-feature notice for its built-in SQLite module.

## Workflow

1. Connect and scan a repository. Scanning does not execute target code, install its dependencies, or modify target files.
2. Configure a model and choose “生成业务知识图谱” in the default business graph view. Scanning alone never calls the model.
3. Explore domains, then expand their processes, shared data, stores, and outcomes. Select nodes to trace incoming and outgoing relations, or edges to inspect data and conditions. Source references expand on demand. Search, dragging, panning, and zooming are available; the application preserves readable text rather than automatically shrinking the entire graph.
4. Use “代码证据” for function search, module filters, and static call paths; “模块依赖” for file imports; and “文档依据” for original documentation.
5. Rescan manually after changes. File hashes detect additions, modifications, and deletions. Unchanged ASTs are reused within a server process; graph relations are rebuilt to remove stale edges. After a restart, the first scan with changes rebuilds the AST cache.
6. Export the generated business graph for the current language and model, or export the code graph from the code view. Exports exclude source text, absolute repository roots, and model keys.

The code evidence view explicitly reports missing directed paths and does not connect unresolved calls based on name similarity. A canvas shows at most 140 ordinary nodes, prioritizing path nodes; use module filters and search for larger repositories.

## Report language

In the application, a substantive primary `README.md` takes precedence when choosing the explanation language; otherwise architecture and other documentation are considered. Code blocks are excluded. Chinese, English, Japanese, Korean, and Russian are detected automatically. Insufficient, unsupported, or mixed evidence prompts manual selection.

The UI allows a language override saved per repository in the browser. Generated business names, explanations, and limitations use the selected language. Original symbols, paths, and source code are not translated; nodes without AI interpretation retain their original symbols. The application interface itself currently uses Chinese.

The **standalone skill** separately chooses its report and HTML control language from the target project's **documentation and code comments**, retaining evidence for that choice.

## Optional LLM configuration

Model settings support Chat Completions-compatible APIs, including local Ollama's `/v1` endpoint. Enter the endpoint and an available model name; cloud services typically require an API key. Browser-submitted configuration stays in the backend process and is not written to the database. Changing the endpoint clears the previous key.

For persistent configuration, use environment variables or copy `.env.example` to `.env`. Startup scripts load `.env` automatically:

```bash
export CODESCOPE_LLM_BASE_URL=http://127.0.0.1:11434/v1
export CODESCOPE_LLM_MODEL=your-installed-model
# Set CODESCOPE_LLM_API_KEY if required by your provider.
npm run dev
```

Only “生成业务知识图谱” and “生成 AI 解读” send selected source snippets, graph relations, and business/architecture documentation to the configured model. Browsing does not call it. Evidence is length-limited; business generation samples across files, while code interpretation uses a bounded neighborhood. Outputs are checked for JSON structure, node IDs, and references. **Reference validation does not guarantee semantic correctness.** Failed generation preserves the previous graph and can be retried.

Business graphs are limited to 8 domains, 32 entities, and 64 relations. The model consolidates shared data objects. Evidence includes at most 100 code snippets totaling 100,000 characters, plus 10 documents of up to 6,000 characters each. Truncation is disclosed. Validation checks entity ownership, endpoints, references, isolated nodes, and read/write direction: reads flow from data to process; writes flow from process to data. Domain summaries aggregate existing cross-domain relations without inventing connections. Relations whose read/write type conflicts with their endpoints remain visible as pending explanations and references, but are not drawn. If every relation is pending, generation fails and preserves the previous graph. Review references for omissions and misinterpretations.

The default local Ollama endpoint (loopback, port 11434) uses a smaller budget: up to 24 code snippets, 3 documents, and 18,000 serialized evidence characters, excluding the system prompt and output schema. Characters are not tokens. Coverage limits appear in the UI. Requests use structured JSON output and request disabled thinking, with a 10-minute application timeout; lower-level network timeouts are reported separately. Other compatible services retain the standard request format and 2-minute timeout. See [Ollama structured output documentation](https://docs.ollama.com/capabilities/structured-outputs).

Restart CodeScope after backend or environment changes: stop the terminal process with Ctrl+C and run `npm run dev` again. The development command does not watch backend code. Browser-submitted model settings must be entered again after restart unless configured through the environment.

Interpretations are cached by repository fingerprint, node, language, and model configuration. Changed scans invalidate old interpretations. The application does not integrate a local AI CLI, MCP, or autonomous question-answering agent, and never downloads or starts models automatically.

## Scope and limitations

- The TypeScript Compiler API handles common functions, methods, arrow functions, and relative imports. tsconfig aliases and third-party type declarations are not resolved yet.
- Literal `app/router/server.get/post/...` registrations are heuristic route candidates, not universal framework support.
- Dynamic dispatch, callbacks, dependency injection, and field propagation may be missed; limitations appear in the analysis scope.
- Python, Java, and Go analyzers are not implemented. Scans report unsupported file counts.
- Scans skip symlinks, hidden files, dependencies, and build directories, and respect directory-level `.gitignore` rules. Limits: 500 KB per file, 4,000 code/document files, and 30 MB of text per scan.
- `.codescope/codescope.sqlite` contains graph and source snapshots and is Git-ignored. Each repository retains its latest successful snapshot; history browsing is unavailable.
- This is a local single-user service without remote-deployment authentication. Do not expose the port directly to the public internet.

## Development and verification

`server/` contains scanning, storage, APIs, and model adapters; `shared/` contains graph contracts and path algorithms; `src/` contains the React UI and independent SVG canvases; `examples/` contains scan targets; `tests/` contains behavior tests.

The canvases use SVG without React Flow. Graph data and rendering are separate. No GitNexus source, prompts, or assets were copied or included as dependencies.

See [verification records](docs/validation.md) and [architecture and planned scope](docs/architecture.md).

## Standalone Business Flow skill

The model-independent [business-flow skill](skills/business-flow/SKILL.md) lets a host model analyze a repository and generate an offline HTML report without starting CodeScope or configuring its model API.

Its viewer opens as a rotating spherical graph and demonstrates one directed path from a random entry. Pause, resume, or choose another entry. Selecting a node pauses playback and reveals both upstream and downstream relations in a stable layout with label-aware collision avoidance. Direction, depth, search, dragging, zooming, and source evidence remain available. Playback illustrates source-derived relations: it does not execute code or evaluate rule conditions. Reduced-motion preferences disable automatic playback.

Enable “Include business rules” to inspect validation conditions, calculations, pass/fail branches, and state changes. Supply a change request or code diff to generate direct/indirect impact highlights in red; see the [impact example](docs/business-flow/order-impact.html). Report text and HTML controls follow the target project's documentation and comment language, with recorded rationale.

See the [interactive order example](docs/business-flow/order-service.html) and [usage guide](docs/business-flow/usage.md), or copy the entire `skills/business-flow/` directory to another agent host. The helper requires Python 3.10+ only; the host model needs filesystem and command tools.

```sh
npm run test:skill          # Python validation/rendering and simulated DOM tests
npm run format:skill:check  # Skill asset formatting checks
```

Simulated DOM tests do not constitute browser visual acceptance or verification in another model host.
