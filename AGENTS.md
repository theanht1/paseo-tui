# Development

- Use Node 26.4 or newer (OpenTUI needs `--experimental-ffi`); keep Paseo packages pinned to 0.15.0.
- Never commit or push unless the user explicitly asks. Use Graphite to amend a tracked branch's current commit.
- Never restart or stop the Paseo daemon on port 6767; this client only reads and steers it.
- Import only public exports: `@getpaseo/client`, `@getpaseo/client/node`, and `@getpaseo/protocol/*`.
- Never import `@getpaseo/client/internal/*`.
- Call `DaemonClient` instance methods only through `src/connection/daemon-adapter.ts`.
- Layers import downward only: `ui/` → `state/` → `connection/` (Biome enforces it); `src/session.ts` wires them; daemon-facing port types live in `src/connection/ports.ts`.
- Tolerate unknown protocol fields and union variants; unknown timeline/stream types render dim `[<type>]` lines without throwing.
- Gate newer capabilities once on `server_info.features`; use them or ask the user to update the daemon. No fallback paths.
- Use strict TypeScript, no `any`, casts that bypass errors, or TypeScript suppression directives.
- Model state with discriminated unions; no defensive branches for states the types rule out.
- UI is OpenTUI + React; keep logic in plain TS modules under `src/ui/**` with unit tests; components stay thin.
- Keep state logic outside React components; prefer function declarations and interfaces.
- Validate at boundaries, trust types internally, and keep changes within the requested scope.
- Test real behavior with small handwritten fakes only at the client boundary; no deep mocks or copy-only tests.
- Colocate tests as `*.test.ts` / `*.test.tsx`; write and run a failing behavioral test before implementing.

Commands: `npm run dev`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
