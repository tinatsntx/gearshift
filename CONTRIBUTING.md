# Contributing to Gearshift

Gearshift is an Apache 2.0 development preview. Issues and pull requests are welcome at <https://github.com/tinatsntx/gearshift>. Describe the problem, intended behavior and relevant validation.

Use Node 22 or newer. Run `npm ci` and `npm test`; the test suite uses synthetic credentials and injected transports, without live Decisions requests. Windows packaging uses `npm run build`. On Linux or macOS, use `npm run build -- --service-only` to build the service and panel. The Windows companion is the currently tested native integration.

Use your own OpenAI API project for any intentional live test. Keep keys, pairing tokens, private Site access, local configuration, transcripts and generated packages out of commits and issue reports. Never use Codex sign-in credentials as an API key. The owner's hosted preview is private; contributors do not receive its transport credentials.

Preserve explicit model or effort pins, full-history forks and encrypted messages. Keep requested settings separate from independently verified runtime settings. Synthetic tests establish behavior, not routing quality or savings. A native acceptance claim needs correlated API, hook, spawn and child-runtime evidence on a named host version; see [release evidence](docs/RELEASE.md).
