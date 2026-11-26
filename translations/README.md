# Chelys translations

Chelys uses the i18next instance and language list from its TeXlyre submodule (`external/texlyre`). The JSON files in `locales/` extend that catalogue with Chelys-specific strings. Shared TeXlyre keys are not copied into these files.

Use literal English keys in `t()` calls, following TeXlyre's conventions: `{name}` in a key and `{{name}}` in its translated value. Add new Chelys-only keys to both `base-en.json` and `en.json`, then translate them in the other locale files. Missing translations fall back to English. Recipe names, user-defined values, logs and protocol identifiers are not translated as data.

The desktop language is selected in Settings → Appearance → Language. Changing it reloads the interface without restarting the backend. The headless runtime retains its dependency-free English string formatter.
