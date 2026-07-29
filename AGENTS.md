# Agent instructions for this project

This app is maintained by a non-technical family; anyone reading this code,
including future contributors, may be a total beginner to programming.

- Comment generously: explain what each function, block, and non-obvious
  line does, even when it would normally be considered "obvious" to an
  experienced developer.
- Prefer clear, descriptive names over short/clever ones.
- If a technical term is unavoidable (e.g. "CRDT", "WebSocket"), add a
  one-line comment explaining it in plain language the first time it appears.
- Keep functions small so each one is easy to read top to bottom.

This overrides the usual "don't over-comment" default for this project only —
readability for a beginner takes priority over brevity here.

## Advisor checkpoints

Consult the `advisor` tool before committing to changes in this repo's
tricky spots, and before declaring work done:

- the data model (parents/spouses shape, id scheme)
- the layout heuristic (generation/x-position algorithm)
- the sync setup (Yjs/y-websocket wiring, persistence)
- before reporting any task in this repo complete

## Ponytail: keep the app itself lazy

The beginner-comment rule above is about *explaining* the code. It does not
mean writing more code than the task needs. Everything below still applies
when deciding *what* to build:

1. **Does this need to exist at all?** Speculative need = skip it, say so in
   one line. (YAGNI)
2. **Already in this codebase?** Reuse an existing helper/pattern before
   writing a new one.
3. **Stdlib/native platform feature covers it?** (e.g. `<dialog>` over a
   modal library, `crypto.randomUUID()` over a uuid package, SVG over a
   charting library.) Use it.
4. **Already-installed dependency solves it?** Use it — don't add a new
   dependency for what a few lines can do.
5. **Can it be one line?** One line.
6. **Only then:** the minimum code that works.

Rules:
- No unrequested abstractions: no interface with one implementation, no
  config for a value that never changes.
- No boilerplate or scaffolding "for later."
- Deletion over addition. Boring over clever.
- Fewest files possible; shortest working diff wins.
- Mark a deliberate simplification that cuts a real corner with a known
  ceiling using a `ponytail:` comment naming the ceiling and the upgrade
  path, e.g. `// ponytail: heuristic layout, swap in dagre/elk if trees grow
  large.`

When NOT to be lazy: never simplify away input validation at trust
boundaries, error handling that prevents data loss (e.g. the delete-unlinks
guard, the parent-cycle guard), or anything the user explicitly requested.
