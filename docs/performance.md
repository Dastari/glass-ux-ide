# Performance

Measured with `scripts/perf-engine.ts`, in Node 24 on a 16-core machine with NVMe storage and 64 GB
of RAM, on 1 November 2026. This is the engine alone, with no browser and no UI. Run it yourself
with `pnpm perf:engine`, or `pnpm perf:engine /path/to/file` for a real file.

Files were freshly written, so some reads may have come from the operating system's cache. Read
the figures as engine cost, not disk cost. Raw sequential reads on this machine measured 1.59 GB/s.

| Measure | Target | 100 GB synthetic | 20 GB real file | 3 GB single line |
| --- | --- | --- | --- | --- |
| Open | | 0.6 ms | 0.7 ms | 0.8 ms |
| First screen of 60 rows | 300 ms | 2.5 ms | 2.8 ms | 42 ms |
| Jump to any byte and read a screen, p99 | 50 ms | 3.9 ms | 3.0 ms | 43 ms |
| Edit at a random offset, p99 | 16 ms | 0.04 ms | 5.1 ms | 4.5 ms |
| One edit in a typing burst, p99 | 16 ms | 0.02 ms | 0.02 ms | 0.04 ms |
| Line number to offset, p99 | 50 ms | not indexed | 9.7 ms | 0.0 ms |
| Undo one step | 16 ms | 0.1 ms | 0.1 ms | 0.1 ms |
| Index throughput | 1 GB/s | | 1.08 GB/s | 1.18 GB/s |
| Line index memory | | | 0.6 MB | 0.1 MB |
| Process memory above baseline | 512 MB | 276 MB | 375 MB | 327 MB |

The figures cover 25,000 edits on one document. Most of the memory is the 128 MB page cache plus
the add buffer and history.

## What real files found

Synthetic data alone hid two problems. Both are fixed, and are why real files stay in this
measurement.

- **Quadratic line counting.** `Uint8Array.indexOf` has no end argument, so counting per block kept
  searching to the end of each read. A file with no line feeds took 32 s to index for 3 GB. Taking
  a view of the block brought that to 2.6 s.
- **Reading every row twice.** Rows were found with one read and decoded from another. The first
  screen of the single-line file took 449 ms before this, and 42 ms after.

Keeping one read in flight while counting the last took a real file from 0.73 to 1.08 GB/s.

## In a browser

The Phase 2 gate in `e2e/gate.spec.ts`: the real editor in headless Chromium with the document in a
worker, opening a real file through `File`, with no React and no glass-ux. Run it with
`GATE_FILE=/path/to/file pnpm exec playwright test e2e/gate.spec.ts --project=chromium`.

| Measure | Target | 20 GB log | 3 GB single line |
| --- | --- | --- | --- |
| Open to first rows, including the test harness | 300 ms | 56 ms | 49 ms |
| Scroll frames over 25 ms, of 240 | 0 | 0 | 1 |
| Scroll frame, p99 | 16.7 ms | 16.8 ms | 16.8 ms |
| Scrollbar jump to new text on screen, p99 | 50 ms | 50 ms | 36 ms |
| Keystroke to DOM update, p99 | 16 ms | 6.3 ms | 3.6 ms |
| Main-thread heap | 50 MB | 10 MB | 10 MB |
| DOM nodes in the editor | | 80 | 80 |

**DOM rows meet the budget, so the canvas fallback in the design is not needed.**

Limits of these figures: Chromium only, headless, on a fast machine, with a 60 Hz frame clock. They
cover scrolling and input, not a full window with glass-ux around it. Keystroke time is from input
event to DOM update; it does not include the browser's own paint.

A 16 KiB row limit gave the single-line file 103 slow frames of 240, because each row made the
browser lay out far more text than any screen shows. At 4 KiB it gives one.
