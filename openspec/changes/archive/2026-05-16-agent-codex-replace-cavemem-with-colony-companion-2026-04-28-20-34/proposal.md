## Why

- Guardex currently prompts for `cavemem` as a global companion, but the active coordination direction is Colony-first.
- Users should see and install the Colony CLI from Guardex setup/status surfaces instead of being prompted for the older cavemem memory tool.
- README companion guidance should include the Colony runtime registration commands and `colony status` check.

## What Changes

- Replace the global companion package mapping from `cavemem` to `@imdeadpool/colony-cli`, displayed as `colony`.
- Update setup/status regression fixtures so missing companion prompts install `@imdeadpool/colony-cli`.
- Update README companion examples to show `colony`, `npm i -g @imdeadpool/colony-cli`, `colony install --ide ...`, and `colony status`.

## Impact

- `gx` and `gx setup` stop asking users to install `cavemem`.
- Colony becomes the detected global companion for multi-agent coordination.
- Existing cavekit/caveman optional local companion handling is unchanged.
