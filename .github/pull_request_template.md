## Summary

<!-- What does this change and why? -->

## Checklist

The PR title must be a Conventional Commit: `type: description`, where type is one of
`feat`, `fix`, `docs`, `chore`, `refactor`, `perf`, `test`, `build`, `ci`.
Merges are squashed, so the title becomes the commit message.

- [ ] `uv run pytest -q -m "not slow"`
- [ ] `npm --prefix frontend test -- --run` (if the frontend changed)
- [ ] `npm --prefix frontend run e2e` (if the UI behavior changed)
- [ ] `uv run ruff check` and `uv run ruff format --check .`
- [ ] Docs and README updated if behavior changed
