---
name: opensrc
description: "Fetch exact dependency or external repository source before inspecting internals. Use for package implementation, upstream behavior, or external GitHub source lookup."
allowed-tools: Bash(opensrc:*)
---

# OpenSrc source lookup

Prefer OpenSrc over a generic clone when inspecting dependency or upstream
implementation code. It resolves package versions from the current lockfile and
caches sources outside the project.

```bash
opensrc path <npm-package>
opensrc path pypi:<package>
opensrc path crates:<crate>
opensrc path <owner>/<repo>[@ref|#ref]
```

Use the printed absolute directory with narrow `rg`, `find`, or file reads. Pass
`--cwd <project>` when dependency resolution must use another project's lockfile.

Do not use OpenSrc for ordinary public API questions that current official docs
or local types answer directly.
