# @thinkrail/pi-visualize

## 0.2.0

### Minor Changes

- [#784](https://github.com/JetBrains/thinkrail/pull/784) [`bbb0e30`](https://github.com/JetBrains/thinkrail/commit/bbb0e3079a1b92080af5c87557a05125e3aafcfb) Thanks [@rsolmano](https://github.com/rsolmano)! - Add `type: "file"` to `visualize`: show an existing workspace file rendered by its type, or a
  before/after diff of two files via `before` — the way to put a UI mockup in front of the user. Hosts can
  inject a `checkFile` validator and a `scratchDir` that the tool's prompt guideline points mockups to; the
  terminal prints the paths.

## 0.1.0

### Minor Changes

- [#597](https://github.com/JetBrains/thinkrail/pull/597) [`a9d8eba`](https://github.com/JetBrains/thinkrail/commit/a9d8eba344de04d2f03058c38599a2971733e1ec) Thanks [@rsolmano](https://github.com/rsolmano)! - First release: the `visualize` tool for vanilla pi — mermaid diagrams and option comparisons with
  box-drawing rendering in the terminal and a pluggable `validateMermaid` seam.
