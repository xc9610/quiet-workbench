# Third-party notices

## Xove Dashboard ordered-grid interaction

The Asterism workbench ordered-grid drag, placeholder, FLIP reflow, resize and
responsive-grid implementation is derived from Xove Dashboard:

- Source: https://github.com/TanYinaia/Xove-Dashboard
- Original copyright: Copyright (C) 2026 by xw

The upstream license text is reproduced below.

> Permission to use, copy, modify, and/or distribute this software for any
> purpose with or without fee is hereby granted.
>
> THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
> REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
> AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
> INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
> LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
> OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
> PERFORMANCE OF THIS SOFTWARE.

## Apex Dashboard component-library reference

The reusable component picker and horizontally scrolling board structure in
Asterism were informed by the open-source Apex Dashboard plugin:

- Project: Apex Dashboard
- Copyright: Copyright (c) 2025 PandoraReads
- Source: https://github.com/PandoraReads/apex-dashboard
- License: MIT

Asterism keeps its own Markdown index, task model, transaction system, Svelte
rendering, layout persistence and write workflows.

## Refresh and widget organization reference (2026-10-06)

The refresh coordinator, visible-view state and Svelte widget components are
independently implemented in Asterism. Their responsibility boundaries follow
the existing implementation plan's behavioral references:

- Hearth: dependency declarations and pending refresh tracking, evaluated commit
  `6ccefa76cf23d674b9bd747aef1bde4f1f772d86`.
- Home Pages: widget state, settings drafts and cleanup responsibilities, evaluated
  commit `2f98a7c44432a5e077977535f94093487417c735`.

No upstream source text was copied into these modules. Asterism retains its own
Markdown services, transaction protection, configuration and Svelte rendering.
Duowei's write queue and virtual window were not incorporated in this round.
