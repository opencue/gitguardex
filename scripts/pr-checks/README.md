# Advisory PR checks

These checks run on unprivileged `pull_request` CI. They do not change the
GitGuardex merge gate or the AI impact and risk scores.

| Upstream | GitHub stars | What GitGuardex uses |
| --- | --- | --- |
| [actionlint](https://github.com/rhysd/actionlint) | [![actionlint stars](https://img.shields.io/github/stars/rhysd/actionlint?style=flat)](https://github.com/rhysd/actionlint/stargazers) | Checks changed workflow files for mistakes such as invalid matrix expressions. |
| [Knip](https://github.com/webpro-nl/knip) | [![Knip stars](https://img.shields.io/github/stars/webpro-nl/knip?style=flat)](https://github.com/webpro-nl/knip/stargazers) | Compares a JS/TS PR with its baseline so pre-existing unused code and dependencies are not reported again. |
| [diff-cover](https://github.com/Bachmann1234/diff_cover) | [![diff-cover stars](https://img.shields.io/github/stars/Bachmann1234/diff_cover?style=flat)](https://github.com/Bachmann1234/diff_cover/stargazers) | Reports measured changed lines and uncovered lines from the existing LCOV or Cobertura artifact; no test rerun. |
| [oasdiff](https://github.com/oasdiff/oasdiff) | [![oasdiff stars](https://img.shields.io/github/stars/oasdiff/oasdiff?style=flat)](https://github.com/oasdiff/oasdiff/stargazers) | Reports breaking changes in a configured local OpenAPI file. Set the repository Actions variable `GX_OPENAPI_SPEC` to its repo-relative path. Remote and external references are not fetched. |
| [reviewdog](https://github.com/reviewdog/reviewdog) | [![reviewdog stars](https://img.shields.io/github/stars/reviewdog/reviewdog?style=flat)](https://github.com/reviewdog/reviewdog/stargazers) | GitGuardex reads its diagnostic JSON format (RDJSON) and also accepts SARIF 2.1.0. No reviewdog bot is installed. |
| [Promptfoo](https://github.com/promptfoo/promptfoo) | [![Promptfoo stars](https://img.shields.io/github/stars/promptfoo/promptfoo?style=flat)](https://github.com/promptfoo/promptfoo/stargazers) | [Offline scoring fixtures](../../evals/pr-impact/README.md) verify normalization and rendering, not model accuracy. It does not run in PR review. |

In the PR's **Checks** tab, open the CI job summary to see available results.
CI uploads them as `gitguardex-checks-<base-sha>-<head-sha>`. Other CI tools
can place RDJSON or SARIF reports for the same revision in
`$RUNNER_TEMP/gx-checks` before the advisory step. Report locations link into
the GitHub diff only when the line is in that diff.

An absent report is not a pass. Coverage is omitted if tests did not complete
or the tested merge tree differs from the PR head. These reports are advisory
and do not become inline review comments.
