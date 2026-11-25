# Optional run statistics

GitGuardex does not upload run statistics by default. You can choose to send a
small event after `gx finish`, `gx branch finish`, or `gx ship`:

```sh
export OPENCUE_RUN_ANALYTICS_HOST=https://analytics.webu.hu
export OPENCUE_RUN_ANALYTICS_PROJECT_KEY=phc_your_project_capture_key
export OPENCUE_RUN_ANALYTICS=1
```

Set `OPENCUE_RUN_ANALYTICS=0` or `DO_NOT_TRACK=1` to stop sharing. Use a capture
project key, not an admin key. If the endpoint is unreachable, the event is
dropped and the command's result stays unchanged. Help, dry runs, and
`gx finish events` do not report anything.

The event contains the operation, whether it succeeded, its duration, and a
fresh random event ID. It does not contain paths, branch or repository names,
code, prompts, arguments, or local logs. GitGuardex does not report token counts
through this integration yet. See the [public sender source and privacy contract](
https://github.com/opencue/run-analytics).
