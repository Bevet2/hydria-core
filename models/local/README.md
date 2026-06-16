# Local Model

Hydria Core uses a dedicated Ollama endpoint on `http://127.0.0.1:11435` with its model store in the project-local directory `models/local/ollama-store`.

Selected runtime model:

- `gemma3n:e4b`

Upstream open-weight training target for future LoRA/SFT:

- `google/gemma-3n-e4b-it`

Why this choice:

- small enough for a realistic local V1
- good instruction following
- good structured output / JSON behavior
- multilingual, including French
- easy local serving through Ollama

Use `scripts/setup-local-model.ps1` to start the dedicated endpoint and pull the model into the project-local store.
