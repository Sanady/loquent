# Changelog

## 0.1.0 (2026-11-21)


### Features

* AG-UI proxy adapter and agent resolution ([17ee0cc](https://github.com/Sanady/loquent/commit/17ee0cc19f761d1f438b814a847412351c4e319e))
* App/serve public API, static UI serving and CLI ([1836151](https://github.com/Sanady/loquent/commit/18361515315a993e90d6937c9067c978056d79f6))
* background run executor with persistence and cancellation ([926408e](https://github.com/Sanady/loquent/commit/926408ef203f2a6a3ba259b9e1ea4e86f9aed975))
* file uploads with signed URLs ([fe903ab](https://github.com/Sanady/loquent/commit/fe903ab193c6ed73dd66e23a31639c8adc092e8e))
* HTTP API for auth, threads, runs, replay and cancel ([952669f](https://github.com/Sanady/loquent/commit/952669f82354390023d7a79f01c3a3e61af18efd))
* MongoDB store backend ([6dbf1f4](https://github.com/Sanady/loquent/commit/6dbf1f4cd0073a8da5a0afa907b4f3348905f429))
* OpenAI-compatible adapter ([14e8bef](https://github.com/Sanady/loquent/commit/14e8bef84a8b125cbb559aca449f8a7fe0bd2b6d))
* package scaffold and AG-UI protocol helpers ([5e119bf](https://github.com/Sanady/loquent/commit/5e119bf997b5ec86aec88de83226a26f4070d062))
* settings, password auth, sessions, bind-safety guard ([0a0a0bc](https://github.com/Sanady/loquent/commit/0a0a0bc2197e4e18c06317da38a55601f255e0d4))
* store interface with SQLite backend and contract suite ([19f3c69](https://github.com/Sanady/loquent/commit/19f3c699bb67cf48504708dc68c7caf0dadf846a))
* **ui:** API client, SSE parsing, reconnect and app state ([4c868e5](https://github.com/Sanady/loquent/commit/4c868e5dbf6a14781acbd3210aa4f75893fbac8a))
* **ui:** chat interface, markdown, run controls, theming ([764b195](https://github.com/Sanady/loquent/commit/764b1959d84b56ddeee4229c5933186d79af235a))
* **ui:** confirm, select and form widgets ([0981c33](https://github.com/Sanady/loquent/commit/0981c33b6201ab63b1879789f8a05cfbb6692838))
* **ui:** frontend scaffold and AG-UI event reducer ([c9c7495](https://github.com/Sanady/loquent/commit/c9c74954199158c6bdc8c876fd0529ac0ea33c3d))
* widgets, run context and function adapter ([9256e87](https://github.com/Sanady/loquent/commit/9256e87b9083b0b27171692188b59bc055d9ab21))


### Bug Fixes

* **adapters:** AG-UI chunks, redirects and empty streams; no-tools retry; sync agents off-loop ([65e116e](https://github.com/Sanady/loquent/commit/65e116e426057f3d0386fcc15f7e0dfdfa47dc11))
* avoid OverflowError on huge integers in number fields ([2d3be31](https://github.com/Sanady/loquent/commit/2d3be317da1debfb12933242a44582291287ceef))
* CLI error handling, module registration, override validation, static hardening ([71c8423](https://github.com/Sanady/loquent/commit/71c8423103be803bd5a14e8afd568dd7247b3138))
* **deps:** require patched pymongo and katex ([#5](https://github.com/Sanady/loquent/issues/5)) ([a422230](https://github.com/Sanady/loquent/commit/a4222303b1132d7034159678be69521916c1e5e2))
* harden OpenAI adapter against malformed and error streams ([4355f72](https://github.com/Sanady/loquent/commit/4355f720041b1bffdbef24c385768597d3aa19ab))
* harden validate_answer against non-finite numbers, duplicates and malformed args ([8a6f3d0](https://github.com/Sanady/loquent/commit/8a6f3d0fbd81977462410222f515168468cd959a))
* multipart truncation handling, CSRF header in auth=none, fresh file URL route ([be7a0f5](https://github.com/Sanady/loquent/commit/be7a0f5bb40f6dbea6263544d327eba475d8181a))
* NoAuth first-request race, empty secret key, host normalization in bind guard ([7e09641](https://github.com/Sanady/loquent/commit/7e096415eadd11b4fe9210a1044cf244a7f88bf3))
* refuse thread delete during a live run; re-check regenerate after create_run ([ff1c3ab](https://github.com/Sanady/loquent/commit/ff1c3ab6850a2c8f6b55d3a9ba307d417d5b2ed8))
* **server:** files-only messages, loopback guard, secret check, widgets switch ([4456208](https://github.com/Sanady/loquent/commit/445620848ce3695715597b0b498b685024a5b16c))
* split serve into prepare/run so runtime errors keep tracebacks; revert unrelated formatting ([13af97d](https://github.com/Sanady/loquent/commit/13af97ddcc9d5bb0b43148771f37378731474f49))
* TestClient counts local; list-pair options; no hash restore starting ([5ddd1e7](https://github.com/Sanady/loquent/commit/5ddd1e726dcd047f23a5ff50a1d6870e4026dd55))
* **ui-store:** regenerate shows the stored thread; thread in #t=; stale streaming flags ([bb82d37](https://github.com/Sanady/loquent/commit/bb82d37e607dd5cd9363adf3d4d97240f0587709))
* **ui:** brand palettes stay readable; drawer and delete focus; plain titles ([e94a744](https://github.com/Sanady/loquent/commit/e94a744a94527fc5dff46db5215c75bae7bb0919))
* **ui:** release run guard at run end, expose starting, abortable stop ([c2da813](https://github.com/Sanady/loquent/commit/c2da81339840386c89d87712f75631c740bf5f87))
* **ui:** single-run invariant, page_query trim, poll backoff ([b54f581](https://github.com/Sanady/loquent/commit/b54f5812933904d53f5cb0479d86f22b9ba935c7))
* **ui:** upload limits and draft restore, Safari-safe attachment tabs, widget contracts ([f3d4e7f](https://github.com/Sanady/loquent/commit/f3d4e7f002476668b742df839180d3fc016d870a))


### Documentation

* contributing, security policy and issue/PR templates ([d2d957c](https://github.com/Sanady/loquent/commit/d2d957c76d3394c7a4ae690962de900822f92645))
* publishing implementation plan ([d48501f](https://github.com/Sanady/loquent/commit/d48501f36c1fb947b6b0c74ff0bd3509c922f877))
* publishing, CI/CD and SEO README design ([2fa77b4](https://github.com/Sanady/loquent/commit/2fa77b4a3d4fcaf2466e0999c83d79fab6a630d4))
* README for discovery — Chainlit migration, stack guides, comparison, FAQ ([a34fb15](https://github.com/Sanady/loquent/commit/a34fb15d6babd0a1d5e7b491ab75b6390c9f6989))
* README review fixes — absolute links, proxy precondition, Chainlit gaps ([c0bb45e](https://github.com/Sanady/loquent/commit/c0bb45e8e70269c08ed82a73166754c0d0e5ae74))
* README screenshot ([adf0cc7](https://github.com/Sanady/loquent/commit/adf0cc7089c75928da4af72f623523fee6e1b514))
* README with quickstart, widgets, security, deployment and settings ([e5bbca1](https://github.com/Sanady/loquent/commit/e5bbca144a8c7894a68e00ebe648a17130b6931b))
* settle builder-check questions in publishing design ([e256df8](https://github.com/Sanady/loquent/commit/e256df8138e838a156c666dca7cb52d3b5276263))

## Changelog
