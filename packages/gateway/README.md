# @decision/gateway

Compatibility rules for this package: [CONVENTIONS.md](CONVENTIONS.md).

The Cerebras structured-output and validation layer supporting
[typesafe-ai-benchmark](../../README.md). The paired runner uses one joint-schema
Qwen response per application decision; the Jev lane calls TypeSafe directly from
the demos workspace. This package also retains a standalone Fastify compatibility
API and separate CLI experiments. [Standalone setup](../../docs/standalone-api.md).

- `src/`: both public routes, contract/codec validation, Cerebras transport,
  scheduling, auth and safe metrics.
- `src/examples/`: reusable synthetic fixtures and caller policies.
- `examples/`: CLI runners for examples, benchmarks and a one-request recording.
- `dist/`: generated ESM and type declarations, consumed by the demos workspace.

From the repository root:

```sh
npm run dev:api        # API watch mode, 127.0.0.1:3000
npm run build -w @decision/gateway
npm start             # compiled API
npm run examples      # offline fixtures
npm run benchmark     # local HTTP baseline
```

Live scripts and startup load the shared root `.env`. Standalone API startup needs
CEREBRAS_API_KEY and a distinct PROXY_API_KEY of at least 16 characters.
CEREBRAS_MODEL sets the jev-latest default (Qwen unless changed). Its HTTP
interfaces remain `/v1/systemone` and `/v1/chat/completions`. See the root
[API reference](../../docs/context/api_reference.txt).

Reports stay in root `docs/` regardless of workspace working directory. Credentials
are not copied into this package. Node 22, npm workspaces and the root lockfile are
the supported toolchain.
