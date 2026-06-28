<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your trainingdata. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AstraFlow Desktop Notes

- This project is the new desktop-focused AstraFlow frontend.
- Prioritize user experience, responsive ergonomics, and clear workflow surfaces.
- Monorepo layout: `apps/web` is the Next.js app, `packages/ui` owns shared shadcn/ui components.
- Use `bunx --bun shadcn@latest add <component> -c apps/web` for shadcn components in this monorepo.
- Keep the first navigation items as `Explore` and `AI Generator` unless the product direction changes.

## Local Workflow

- Use `bun run lint` and `bun run typecheck` as the default verification commands.
- Do not run compile/build commands such as `bun run build` unless the user explicitly asks for a build or the change is release-critical.
- Do not start the dev server unless the user explicitly asks for it.

## Frontend Pitfalls

- If the route header already shows the page title, do not repeat the same page title in the page body.
- Keep control widths content-aware. Avoid fixed or minimum widths that leave obvious empty space; use max-width only when needed to prevent overflow.
- Use compact inline controls for dashboard filters. Search icons inside inputs should be small, around 16px, and visually secondary.
- Put summary counts such as `4 active · 4 total` after search and filter controls when those controls are present.
- Center table headers and center table body content for management tables unless a column needs a deliberate exception for readability.
- For table cells containing nested flex layouts, center the nested content too so it aligns with centered headers.
- Choose chart types by data semantics: area charts for time trends, bar charts for ranked comparisons, andpie/donut charts for small part-to-whole breakdowns.
- Do not add decorative color strips or accents to KPI cards unless they encode data. Keep color primarily in charts and status indicators.
- For lightweight details, show as much useful information inline as fits, then use a small Popover or simple secondary floating panel from an `i`/info control for overflow details. Avoid right-side Sheets for smallread-only details; reserve Sheets for larger forms and workflows.
- For fixed-height desktop pages, lock the shell height at the app frame and let only the intended content pane scroll. Do not leave body/page scrolling active when headers and filters should stay fixed.
- In a fixed-height app shell, normal pages need a shell-owned `min-h-0 flex-1 overflow-y-auto` content pane. Keep `overflow-hidden` only on the frame or on views that implement their own internal scroller, otherwise lower content can be clipped with no vertical scroll.
- Pages that own their internal scrolling, such as Chat or dense explore surfaces, must be mounted in a shell wrapper with `flex min-h-0 flex-1 overflow-hidden`, not a shell-owned `overflow-y-auto` pane. Otherwise fixed filters/search bars and internal list scrollers break.
- For GSAP/page transitions, keep scroll containers responsible only for layout and scrolling. Animate an inner surface with `opacity`/`transform`; do not animate the `overflow-y-auto` or `overflow-hidden` element itself.
- Do not replay the whole sidebar navigation animation for ordinary primary-page changes. Animate only realmode changes such as primary navigation to Chat history.
- In the persistent App Router shell, keep previous-view transition state local to the transition componentinstance. Do not persist it in `sessionStorage`, because refreshes, deep links, and login redirects can replay stale page directions.
- When a child view relies on `flex-1` to fill the shell, every wrapper between the shell and that view must either be a flex container (`flex min-h-0 flex-1`) or provide an explicit full height. A block wrapper with only `flex-1` will not let nested empty states or scroll regions center/fill correctly.
- Do not use CSS grid auto rows as the direct scrolling container for long card lists in fixed-height panes; auto rows can compress card height and clip content. Use an outer `overflow-y-auto` pane with an inner natural-height flex column, and mark cards `shrink-0`.
- Provider-style helpers may render no wrapper DOM. Do not rely on them as flex parents; add an explicit `min-h-0 flex-1 flex flex-col` wrapper before expecting nested scroll areas or centered empty states to fill available height.
- Do not render centered empty states inside `StickToBottom` or chat scroll containers. Those containers intentionally lock to the bottom and can override centering. Render empty-state composers in a separate flex-fill pane, then switch to `StickToBottom` only after messages exist.
- When syncing Vercel AI SDK `useChat` messages with local chat history, hydrate `useChat` only when the active session id changes, and return the previous sessions array when no messages/preferences actually changed. Otherwise React can hit maximum update depth from a history/messages feedback loop.
- On Chat-like pages, use the left sidebar as a secondary chat-history menu after entering Chat. Do not adda separate history column inside the main chat canvas.
- When adding prompt-kit, install/use component entries for the product UI. Do not add registry primitive demo API routes or OpenAI demo routes unless explicitly requested.