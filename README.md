# Glass UX IDE

A code editor, reusable editing components and backend interfaces for
[glass-ux](https://github.com/Dastari/glass-ux) applications. It is a component library: applications
connect it to their own backend, or use just the editor. It ships no server software.

Version 0.1.1. Install it from the release, beside glass-ux 0.16.1:

```sh
pnpm add \
  https://github.com/Dastari/glass-ux/releases/download/v0.16.1/glass-ux-0.16.1.tgz \
  https://github.com/Dastari/glass-ux-ide/releases/download/v0.1.1/glass-ux-ide-0.1.1.tgz
```

The [documentation site](https://dastari.github.io/glass-ux-ide/) has every component, the guides and
the [demo](https://dastari.github.io/glass-ux-ide/demo). [CHANGELOG.md](CHANGELOG.md) says what is in
this release, and the [design](docs/DESIGN.md), section 20, what remains.

- [Getting started](docs/getting-started.md), [backends](docs/backends.md) and
  [code windows](docs/code-windows.md).
- [Design](docs/DESIGN.md): architecture, decisions, public API, upstream requests and plan.
- `apps/docs`: the documentation site, with the demo application at `/demo`.
- `mockups/glass-ux-ide-mockups.html`: the first design's mock-ups in one file, kept as a record.
- [Performance](docs/performance.md): measured results for the engine and the editor.

To work on the engine and editor:

```sh
pnpm install
pnpm check        # boundaries, types, lint and unit tests
pnpm lab          # the editor on a bare page, http://127.0.0.1:4320
pnpm test:e2e     # browser tests in Chromium
pnpm test:browsers  # the same in Chromium, Firefox and WebKit, where their system libraries exist
pnpm perf:engine  # engine benchmarks; pass a path for a real file
pnpm build        # the package, into dist
pnpm docs:dev     # the documentation site and demo, from source
pnpm docs:build   # API pages and the site, into apps/docs/dist
```

To change the mock-ups:

```sh
cd mockups
pnpm install
pnpm dev      # http://<host>:4310, serves on the LAN
pnpm build    # typechecks, then rewrites glass-ux-ide-mockups.html
pnpm shots    # needs Chromium's system libraries; see below
```

`pnpm shots` needs libraries this box does not have installed system-wide. Point at the existing
cache first:

```sh
export LD_LIBRARY_PATH=$HOME/.cache/glass-ux-browser-libs/root/usr/lib/x86_64-linux-gnu
```
