# T1 Notes

- Fix the optional CR workflow so GitHub can start it without evaluating `secrets.*` inside a workflow/job-level `if`.
- Keep the pinned `anc95/ChatGPT-CodeReview` action reference from the previous fix.
- Add regression tests so the workflow keeps using `env.OPENAI_API_KEY` for conditional execution.
