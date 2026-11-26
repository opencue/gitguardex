# PR impact evaluation

This opt-in suite replays fixed inputs through GitGuardex's diff parser, score
normalizer, and Markdown renderer. It checks separate benefit and risk axes,
missing or invalid evidence, and that unavailable evidence is not rendered as
zero or neutral. It does not measure the quality of a model's estimates.

Provision **Promptfoo 0.125.1** ahead of time (for example,
`npm install --global promptfoo@0.125.1` in a disposable tool environment).
From the repository root, run the installed CLI in a network-disabled
environment. On Linux with unprivileged user namespaces enabled:

```sh
scratch="$(mktemp -d)"
unshare --user --map-root-user --net \
  env -i PATH="$PATH" HOME="$scratch" PROMPTFOO_CONFIG_DIR="$scratch" \
  PROMPTFOO_DISABLE_TELEMETRY=1 PROMPTFOO_DISABLE_UPDATE=1 \
  PROMPTFOO_DISABLE_SHARING=1 \
  promptfoo eval -c evals/pr-impact/promptfooconfig.yaml --no-cache --no-write
```

The custom provider is local JavaScript; no model, credentials, or upload are
needed. Normal PR runs do not install or invoke Promptfoo.
