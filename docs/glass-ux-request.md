You are working in the glass-ux repository (/home/toby/dev/glass-ux, github.com/Dastari/glass-ux).
Two sister packages are being designed on top of it: glass-ux-image (image editing components) and
glass-ux-ide (code editing components). Both need general components that belong in base glass-ux.
Your job is to add them here.

Both sister packages are component libraries. They ship no server software, and security,
authentication and transport belong to the host application. Nothing added here should assume
otherwise.

Read first:
- AGENTS.md, README.md, docs/ui-rules.md and docs/layout-contract.md. Follow them throughout.
- /home/toby/dev/glass-ux-image/PROPOSAL.md, section "Requests to Glass UX". Read only. Its bracketed
  numbers are out of date; use the component names in this brief.
- /home/toby/dev/glass-ux-ide/docs/DESIGN.md, section 18 "What should live in base glass-ux" and
  section 9 "Backend interfaces". Read only.

Ground rules:
- The test for inclusion: it must make sense in an application that never edits an image or code.
  Nothing here may depend on, name or assume either sister package. No image-engine, GPU or
  text-engine code.
- Before starting any item, check it against current main. These requests were written against
  0.13.0, 0.13.1 has since shipped, and glass-ux keeps moving. Branches feat/gaps-0.14 and
  t3/add-geometric-icon-batch exist with no commits at the time of writing; check whether they are
  now in use. If something already exists or the premise is wrong, say so and skip it instead of
  building it.
- The Menubar is built after the shortcuts work, so it can show chords. No earlier Menubar work
  exists. Its requirements are at the end of this brief.
- Prefer extending an existing component through props and slots over adding a new one (R1.3).
- Every public addition needs TSDoc, a catalogue page with a working demo, messages in every
  language pack, controlled and uncontrolled state, keyboard and RTL support, and tests. Run the
  checks AGENTS.md requires, including density, UI scale, radius and line weight checks.
- Use one branch per group below, with small, separately reviewable commits. Do not merge to main,
  bump the version or publish a release. The owner decides when to publish.
- Do not change behaviour for existing consumers unless it is a bug fix. Call out any API change.
- The owner judges visual changes in a browser, so provide isolated demo pages to compare them.

Group 1: small and self-contained. Do these first.
1. Bug: ColorField shows "e8875a#" in RTL layouts. The hex input needs dir="ltr". Confirmed on
   0.13.0 with DirectionProvider in place. Add a regression test.
2. SliderField: label, slider and current value on one row, built on Slider and the Field
   conventions. Every slider in the image mock-ups needed this and had to hand-roll it.
3. Panel: a compact option. The mock-ups had to override --inset-panel to get dense tool panels.
4. Toolbar: vertical orientation, single-choice groups (exactly one tool active, exposed correctly
   to assistive technology), and an item that opens a flyout of related tools.
5. ColorPicker: a compact size, and an optional HSV plane beside the existing perceptual plane.
6. Export readingKey and isRtl, plus useScrollEdges and any similar hooks that sister packages are
   copying. Add public clipboard and debounce hooks: copy-button.tsx and data-table.tsx each call
   the clipboard themselves, and several components debounce separately.
7. Icons, authored to docs/icon-spec.md through pnpm icons: crop, rotate, flip, brush, text, adjust.
   Note that the existing icon named "zoom" is the Zoom brand mark, not a magnifier, so pick names
   that cannot be mistaken for it. Also add: save, file-plus, folder-plus, braces, arrow-left-right,
   replace, regex, case-sensitive, whole-word, fold, unfold, collapse-all, split-horizontal, indent.
8. Shared code tokens. The syntax colours (--fa-code-token-*) are scoped to .fa-ai-code and have no
   role for types. Promote them to shared --code-* roles and add a type role, so anything showing
   code matches. Code blocks must look the same afterwards. Check contrast in every palette, in both
   modes (R20.1).
9. useAnnounce: a public hook for one shared, always-mounted polite live region (R20.9). Many
   components hand-build aria-live today. Do not migrate them in this work, and say which would
   benefit.

Group 2: new general components.
10. ImageCropper and ImageField. This is the highest-value item in this group. Extract the crop
    logic from src/ui/avatar (avatar-dialog.tsx, avatar-image.ts) into a general ImageCropper with
    aspect ratios, and an ImageField for forms. EditableAvatar must become a preset of it with no
    behaviour change. Keep the existing contract: the library never uploads, and onSave receives
    the result plus { signal, setProgress }. ImageField should accept an optional onEdit handler,
    so a host can open a richer editor without glass-ux knowing what that editor is.
11. CompareSlider: a before and after divider for any two pieces of content, not only images.
    Keyboard operable, and correct under RTL.
12. GradientPicker: beside ColorPicker, built on it. Stops, position, linear/radial/angular.
13. Histogram chart in the charts family: for any distribution. It takes binned data. Computing
    bins from pixels stays in the host.
14. usePanZoom: wheel, pinch and keyboard zoom. Map, topology and avatar each have their own code.
    Check whether one hook can really serve them before extracting. If not, explain why.
15. useUndoStack: a generic undo and redo stack for forms, kanban and schedulers. Sister packages
    keep their own engines, so keep this small.
16. Anchored typeahead. Extract the mention and slash-menu typeahead from
    src/ai/composer/composer.tsx into a general primitive: a listbox positioned at a caret or any
    rectangle, with focus staying in the text. Base UI menus move focus, which text entry cannot
    allow, so use aria-activedescendant. It needs a filter-free mode (the host supplies items), an
    optional detail pane beside the list, and results that arrive late without moving a row under
    the pointer (R9). Composer must behave exactly as before. This is the roadmap's mentions and
    slash menu item, so make it usable by RichTextEditor too.
17. FindBar: a floating find control for logs, tables and long documents. Term, toggles through a
    slot, a match count, previous and next, and an optional replace row. It holds no search logic:
    the host owns matching and supplies the count, which may still be climbing while a search runs.
    Reserve the count's width (R9.1), announce it politely, and return focus on Escape (R20.3).
18. ActivityFeed as a timeline. Extend ActivityFeed rather than adding a component. ActivityItem has
    only id, content, at and icon. Add a selected item, a tone for the marker, and one level of
    nesting for branches, so it can show a version history. Selection makes it a composite widget
    (R11.5). A plain feed must stay exactly as it is.
19. DiffView: a general unified diff from src/ai/results/diff.tsx, from the roadmap. Keep the current
    look, with the sign in the gutter so a change reads without colour. Expose the add and remove
    tints as token roles, so a sister package with its own virtualised diff can match. ResultDiff
    should become a thin wrapper with no visual change.
20. Focus regions: F6 and Shift+F6 move between an application's landmarks. Make it a small hook, and
    an opt-in AppShell prop so existing applications are unchanged. Keyboard users need this to
    leave a text editor or terminal-like region. Check how it interacts with browser F6 handling.
21. Breadcrumb: a compact size for a path inside a pane. R6.4 says one breadcrumb, in the top bar,
    so a path that describes content rather than the route needs a rule. Propose the wording and
    stop for owner approval on that sentence before changing docs/ui-rules.md.

Group 3: extensions shared with glass-ux-ide and glass-ux-image.
22. Tree: drag to reorder, multi-select (R11.8) and inline rename. Also add a slot for trailing row
    content, and a public way to reveal a node by id, which exists internally through the
    virtualiser. All of this must work with virtualisation and with lazily loaded branches
    (onLoadChildren, onLoadMore). An explorer can hold very large folders, so a selection must not
    require every node to be loaded.
23. Tabs: closable, reorderable, unsaved marker. Also: middle-click and keyboard close, keyboard
    reordering as well as drag (R11.2), the unsaved marker in the accessible name (R20.5), a
    context menu slot (R11.6), and a preview state for a tab that a next click would replace.
    Overflow keeps the active tab visible (R6.6). Dragging a tab to another strip must be possible,
    because the dockable layout in item 26 depends on it.
24. Shortcuts: chords (such as mod+k mod+s), user rebinding and a help dialog. parseShortcut reads
    one combination today, and Kbd must display a chord. Add a serialisable keymap, conflict
    detection, and a central dispatcher that can include text inputs when a binding asks for it.
    Build on defineActions (R1.2), so menus, the palette and shortcuts share one definition. Keep
    useHotkeys working unchanged.
25. StatusBar: a general application status bar that also works in a window's status slot. Start and
    end groups, interactive items, and a stated order in which items give way in a narrow box (R7.4).
    WindowFrame.StatusBar should keep working, built on it if that is clean.

Group 4: design first. Do not write code for these yet. Write a short design for each, covering
the API, how both sister packages would use it, and what is left out, then stop for owner approval.
26. Dockable panel layout: tabbed, resizable, draggable panels with saved layouts. It must serve an
    image editor's panels and the IDE's workbench, and it needs a keyboard alternative to dragging.
    Say how it relates to SplitPane and glass-ux/windows. The IDE also needs:
    - any number of panes in nested splits, usable without tabs, for mail and dashboards as well;
    - a layout that serialises to JSON, with host-owned identifiers for content;
    - content that keeps its state when a pane moves, because a mounted editor is expensive and
      holds scroll and selection. Say how moving a pane avoids remounting;
    - drags that write a custom property and commit once (R14.5, R18.5);
    - an account of how the layout collapses on a phone (R21).
27. File provider contract and FileDialog: a shared provider interface and open and save dialogs,
    so one storage adapter works across sister packages. Start from FileSystemProvider in section 9
    of the IDE design. Image editing also needs thumbnails and a conflict result on write (a base
    version check). The IDE depends on these, so keep them:
    - ranged reads with an AbortSignal, because huge files are read a page at a time;
    - a version on stat, and a conflict result on write;
    - optional applyEdits, so a backend can save a small change without rewriting the file;
    - paged directory listings;
    - every capability beyond reading is optional, and the dialog adapts to what is present;
    - types that import no DOM or React, so they can be used inside a worker.
    The contract carries no authentication. A provider arrives already able to do its job.
28. Docs kit: publishing the docs scripts and page shell for sister projects. scripts/docs-api.mjs
    hard-codes src/ui and the glass-ux entry names, the gallery is left out of the package, and the
    check scripts are not published. Sister packages need generated API pages in the same format,
    the catalogue page shell with examples, usage and API sections, and the checks. Say what is
    published, and how a sister package configures its entries and package name.

Requirements for the Menubar, which follows item 24. The IDE needs it to take its items as data, show shortcuts including chords, support submenus, check and radio
items and disabled reasons (R12.3), switch menus on hover once one is open, and collapse into one menu
in a narrow box (R7.6).

When you finish, or when you stop for approval, report:
- What was built, on which branch, and what was verified, with any test failures quoted.
- Items skipped because they already exist, or because the premise was wrong.
- Any API or behaviour change for existing consumers.
- Which items sister packages can now use, and the release they need to wait for.

### Image workspace Phase 2 follow-up (2026-11-03)

PaneLayout could expose an overlay-track mode (or an equivalent public placement/slot contract):
keep the primary picture or document filling the layout while accessory stacks float over it,
retaining their existing identity, collapse, resizing and rearrangement behaviour. A host motion
flag should also reach the material's existing `data-moving` treatment on those stacks.
ImageEditor Focus currently composes this with structural pane CSS and marks the material nodes
for the gesture. It uses public imports, but a public contract would remove that DOM coupling.
Free-position windows remain the separate `glass-ux/windows` concern.

### glass-ux-image Stage 3 follow-up (2026-11-03)

Found while building glass-ux-image's tools and ImageEditor on 0.14.0. Each is general, not image-specific.

1. **Public cached number and percent formatters.** `glass-ux-image/src/react/format.ts` keeps its own
   per-locale `Intl.NumberFormat` cache for counts and whole percentages, because Glass UX's are not public.
   `formatBytes` from `byte-size-field` is already public and used; counts and percentages are the gap.
2. **Centred fill for two-way `Slider`.** A -100 to 100 slider at 0 fills from the minimum and looks half
   set. Exposure, contrast, temperature, tint and about 25 more develop sliders are two-way. Something like
   `fillFrom="center"` or `origin={0}`, filling from the origin toward the thumb, in both directions, RTL-aware.
3. **A circular colour wheel.** Colour grading (shadows, midtones, highlights) and colour balance use hue and
   strength around a neutral centre. Today `ColorWheel` in glass-ux-image is the rectangular `ColorPicker`
   plus signed sliders. A wheel control with a value of `{ hue, amount }`, a neutral centre, a keyboard path
   (arrows for hue and strength) and an accessible value text would serve any app picking a hue and intensity.
4. **Imperative focus-region navigation.** `useFocusRegions` binds F6 itself and returns only shortcut text.
   ImageEditor routes every shortcut through `defineActions` so a host's `onAction` can veto or rebind it,
   so it keeps its own region traversal (`src/editor/image-editor.tsx`), missing remembered focus per region
   and the shared modal and inert checks. A returned `next()` / `previous()` pair, or a `bind: false` option,
   would let it use the shared behaviour.

### glass-ux-image docs site follow-up (2026-11-03)

1. **A badge for section pages.** `FoundationDocumentation` always badges "Foundation". glass-ux-image documents
   tools, filters and kits as section pages and rewrites the badge after render. A `badge` prop or a `badge`
   field in `SectionMeta` would remove that.
2. **Template pages in the kit.** `TemplateDocumentation` and `TemplatePreview` live in Glass UX's own gallery,
   not in glass-ux-docs-kit, so glass-ux-image copies their structure. Exporting them would let sister packages
   use them directly.

### glass-ux-image toolbar follow-up (2026-11-03)

1. **`Toolbar.Button` with only `disabledReason` reads as enabled.** Outside a toolbar, `Button` with
   `disabledReason` renders `aria-disabled="true"`. Inside `Toolbar`, `Toolbar.Button` with `disabledReason`
   and no `disabled` renders `data-disabled` but `aria-disabled="false"`, so assistive technology hears an
   enabled button that does nothing. glass-ux-image passes `disabled` as well for its rail Reset button
   (`src/editor/parts.tsx`). Expected: `disabledReason` alone implies disabled, as it does on `Button`.

### glass-ux-ide follow-up after 0.15.0 (2026-11-04)

1. **`registerMessagePack` replaces an earlier pack for the same locale.** A sister package's pack for
   Arabic, registered after glass-ux's, removes glass-ux's Arabic words. glass-ux-ide works around it with
   `combineMessagePacks`. Expected: packs for one locale merge by namespace.
2. **`SearchTrigger` ignores `aria-label`.** It sets its own `aria-label` after the rest of the props, so a
   host's custom `placeholder` fails label in name (axe `label-content-name-mismatch`). glass-ux-ide keeps
   the default wording. Expected: a host's `aria-label` wins, or the default name follows `placeholder`.
3. **Menu rows with and without icons do not line up.** A tab menu mixes the host's rows, which have icons,
   with PaneLayout's Maximise, Move to and Close, which have none, so labels start at two different edges.
   Expected: a menu with any icon reserves the icon column for every row, or PaneLayout's rows take icons.

