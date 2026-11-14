# Browser quality plan

This plan covers the ESP32-A1 Audio Lab browser application in an isolated HTTP fixture. Firmware flashing, physical device access, analog audio measurements and file-scheme browser pages are excluded.

The test planner is an explicit coverage table maintained with this project. fast-check generates input values, command sequences and scheduled completions; axe-core supplies automated accessibility checks; gremlins.js supplies supplemental stress actions. The browser's visible controls and a separate mock transport provide the test observations. This run does not invoke Playwright Test Agents, GraphWalker or a browser extension.

## Required coverage

| Area | Required checks |
|---|---|
| Inputs | 153 cases across 33 controls: number/range pairs, enumerations, toggles, recording duration, WAV paths, hex value/mask, waveform selection/window, themes/languages, route highlighting and JSON import. Check boundaries, empty values, fractions, malformed text and absence of implicit writes. |
| Diagram entries | Every node in both diagrams: 23 professional and 11 simple entries. Each must open the correct editor without a control write. A new unmapped node fails the audit. |
| Directed workflows | Stop-all, incorrect clock readback, capture, delayed gain submission/navigation, voice/VAD, duplex/reference, recording/unmount guard, file playback, preparation failure recovery, write failure/retry, protected/masked register access and read-only reconnect. |
| Model/property checks | 7,700 generated runs using fixed seeds, including arbitrary invalid types, immutable validation results, exact readback checks, path boundaries, scheduled replies and a simplified draft/submission/revert model. Failing cases retain fast-check seed/path information. |
| Accessibility | At least 24 scans: six palettes, form panels, both languages, both diagrams and waveform views. Keep all axe incomplete findings for review; do not count them as passes. Supplement SVG text with computed foreground/background contrast checks. |
| Stress | A seeded 300-action run with semantic checks for implicit writes, mismatched channel titles and contradictory mode controls. |
| Native review | Actual browser keyboard/focus, invalid numeric input and recovery, native file chooser/download, narrow-window waveform visibility, resizing/pan/fit, and intentional overlay review. |

## Acceptance gates and self-assessment

Any failed test, unresolved rule violation, unreviewed non-contrast incomplete rule, incorrect editor, unhandled exception or stale browser bundle blocks acceptance. All planned input cases and directed workflows must pass. Contrast incomplete results caused by overlays require a recorded visual review; SVG foreground/background checks must pass independently.

The self-assessment weights are input contracts (2), transactions/recovery (3), interaction/navigation (2), accessibility/readability (2) and reproduction/isolation (1). The project verifier records both scores and deductions after the hard gates pass. A score below 9/10 is not accepted. This is a self-assessment of this browser scope, not a certification or physical-device result.

## Reproduce

Use Node.js 22+ and Python 3:

```sh
npm ci --ignore-scripts
npm test
npm run build
npm run test:browser
```

Open the printed HTTP fixture URL. It replaces Web Serial before application startup, disables native device/media APIs and sends restrictive Permissions-Policy headers. If the fixture cannot be assembled, the server fails closed. Only the isolated HTML entry is served. Do not substitute a production or file-scheme page.

The same server exposes `/preview.html` for interactive demonstrations and screenshots. It uses the identical fake transport and permissions restrictions, keeps a visible simulated-device label and omits the audit toolbar. Use `/bundle-test.html` to collect test reports.

Choose Run full audit to execute the accessibility, input, workflow and seeded-stress passes in order. Individual buttons support focused reruns during diagnosis. Complete the native review separately and preserve screenshots. Reports default to the workspace's `work/a1-quality-20261114` directory; `--reports` selects another task-owned directory. Stop the server and close test tabs after the run.

```sh
node tests/quality/verify-audit.mjs <quality-report.json> <manual-review.json>
```

The verifier compares the served bundle's LF-normalized text hash, records the distribution file's raw byte hash, reruns Node tests and writes the scorecard. This keeps Windows line-ending differences distinct from stale or changed application code.

Method references: [fast-check models](https://fast-check.dev/docs/advanced/model-based-testing/), [scheduled race checks](https://fast-check.dev/docs/advanced/race-conditions/), [axe API](https://github.com/dequelabs/axe-core/blob/develop/doc/API.md). These techniques supplement native browser interaction and review.
