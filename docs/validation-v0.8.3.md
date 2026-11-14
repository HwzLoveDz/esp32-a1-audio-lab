# v0.8.3 default theme

Mint is the first-run theme. The initial HTML selects it before the main application loads; a saved Light, Mint, Graphite, Ocean, Pine or Ember preference takes precedence. Missing, invalid or inaccessible storage leaves Mint active. Starting the page does not overwrite a saved preference.

The actual inline startup script is executed in isolated JavaScript contexts to check absent/invalid storage, all six saved themes and a storage-access exception. The full Node web/protocol suite passes 83 tests. The standalone application is rebuilt from the same source. Device commands, firmware and audio processing are unchanged.

The broader browser workflow checks remain documented under [v0.8.2](validation-v0.8.2.md), and the README screenshots retain their v0.8.2 labels.
