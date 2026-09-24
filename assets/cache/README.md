# Committed Jev answers

Answers from Jev (TypeSafe System One) that are committed so every install gets
them without an API key or a network call. Each file is `<key>.json`, where the key
is the SHA-256 of the asking feature's question version, the question
definitions, and the state. See the Jev section of `docs/DESIGN.md`.

Files here are written by `ask` from `@thesnug/color-picker/jev` with
`cache: COMMITTED_CACHE_DIR`, never by hand. Bumping a feature's question version
orphans its old files; delete them in the same PR.
