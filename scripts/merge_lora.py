"""
merge_lora.py — Merge a LoRA adapter into the base model and export for Ollama.

Steps:
  1. Load the LoRA adapter from --adapter_path
  2. Merge into the base model weights
  3. Save merged model as HuggingFace format to --merged_output_dir
  4. Create an Ollama Modelfile at --modelfile_path
  5. (Optional) Convert to GGUF if llama.cpp convert.py is available at --llama_cpp_dir

Usage:
  python scripts/merge_lora.py \
    --base_model Qwen/Qwen2.5-3B-Instruct \
    --adapter_path outputs/student-local-3b-lora-v1 \
    --merged_output_dir outputs/student-local-3b-merged \
    --modelfile_path outputs/student-local-3b-merged/Modelfile \
    --ollama_model_name hydria-student-v2 \
    [--llama_cpp_dir /path/to/llama.cpp] \
    [--gguf_output_path outputs/student-local-3b-merged/model.gguf] \
    [--dry_run]
"""

import argparse
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import traceback
from pathlib import Path


STUDENT_SYSTEM_PROMPT = """You are the local student answerer inside Hydria Core.

Rules:
- Answer the user question directly.
- Detect the user's language and answer in that same language.
- Keep the JSON keys exactly as specified; translate only the string values.
- Stay simpler and more compact than the external teacher.
- Be explicit about assumptions and uncertainty.
- Keep answer under 140 words unless the user explicitly asks for a longer artifact.
- Use 2 to 5 short key_points; they are labels, not copied full sentences.
- Use 0 to 3 concise assumptions.
- Do not invent unsupported facts.
- Never use markdown bullets, bold markers, headings, or code snippets inside JSON string values.
- Never put a nested JSON object, array, or JSON-like checklist inside the answer string.
- Return strict JSON only. Never include markdown fences.

STABLE KNOWLEDGE — answer directly without requiring external verification:
- Well-known historical figures and events (e.g. "qui est Napoleon", "what was WW2")
- Mathematical constants and theorems (e.g. speed of light, Pythagoras theorem)
- Established scientific facts and laws (e.g. photosynthesis, Newton's laws)
- Standard technical definitions that do not change over time (e.g. "what is TCP/IP", "what is idempotency")
- For stable knowledge, answer confidently from your training. Do NOT say "I cannot verify" for these.

TEMPORAL AND LIVE DATA — apply "cannot verify" ONLY to:
- Current prices, exchange rates, stock values
- Real-time weather, news, or status
- Latest versions, release dates, or recent events that may have changed since your training cutoff

Output keys only: modelRole, answer, key_points, assumptions, confidence."""


def fail(message: str, code: int = 2) -> None:
    print(f"[merge_lora] ERROR: {message}", file=sys.stderr)
    raise SystemExit(code)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Merge LoRA adapter and export for Ollama.")
    parser.add_argument("--base_model", required=True, help="HuggingFace base model name or path")
    parser.add_argument("--adapter_path", required=True, help="Path to the LoRA adapter directory")
    parser.add_argument("--merged_output_dir", required=True, help="Where to save the merged HF model")
    parser.add_argument("--modelfile_path", required=True, help="Path to write the Ollama Modelfile")
    parser.add_argument("--ollama_model_name", default="hydria-student-v2", help="Name for the Ollama model")
    parser.add_argument("--llama_cpp_dir", default=None, help="Path to llama.cpp repo (for GGUF conversion)")
    parser.add_argument("--gguf_output_path", default=None, help="Where to write the GGUF file")
    parser.add_argument("--report_file", default=None, help="Path to write a JSON report")
    parser.add_argument("--dry_run", action="store_true", help="Check dependencies only, do not run")
    return parser.parse_args()


def check_dependencies():
    required = ["torch", "transformers", "peft"]
    missing = [name for name in required if importlib.util.find_spec(name) is None]
    return missing


def merge_adapter(base_model: str, adapter_path: str, merged_output_dir: str) -> None:
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    print("[merge_lora] stage=load_tokenizer", flush=True)
    tokenizer = AutoTokenizer.from_pretrained(base_model, trust_remote_code=True)

    print("[merge_lora] stage=load_base_model", flush=True)
    import torch
    dtype = torch.float16 if torch.cuda.is_available() else torch.float32
    base = AutoModelForCausalLM.from_pretrained(
        base_model,
        torch_dtype=dtype,
        device_map="auto" if torch.cuda.is_available() else None,
        trust_remote_code=True
    )

    print("[merge_lora] stage=load_adapter", flush=True)
    model = PeftModel.from_pretrained(base, adapter_path)

    print("[merge_lora] stage=merge_and_unload", flush=True)
    merged = model.merge_and_unload()

    print(f"[merge_lora] stage=save_merged path={merged_output_dir}", flush=True)
    Path(merged_output_dir).mkdir(parents=True, exist_ok=True)
    merged.save_pretrained(merged_output_dir)
    tokenizer.save_pretrained(merged_output_dir)
    print("[merge_lora] stage=merge_complete", flush=True)


def try_convert_to_gguf(merged_output_dir: str, gguf_output_path: str, llama_cpp_dir: str) -> bool:
    convert_script = Path(llama_cpp_dir) / "convert_hf_to_gguf.py"
    if not convert_script.exists():
        # Try older name
        convert_script = Path(llama_cpp_dir) / "convert.py"
    if not convert_script.exists():
        print(f"[merge_lora] llama.cpp convert script not found in {llama_cpp_dir}", file=sys.stderr)
        return False

    print(f"[merge_lora] stage=convert_gguf output={gguf_output_path}", flush=True)
    result = subprocess.run(
        [sys.executable, str(convert_script), merged_output_dir, "--outfile", gguf_output_path],
        capture_output=True,
        text=True,
        timeout=600
    )
    if result.returncode != 0:
        print(f"[merge_lora] GGUF conversion failed:\n{result.stderr}", file=sys.stderr)
        return False

    print(f"[merge_lora] stage=gguf_ready path={gguf_output_path}", flush=True)
    return True


def write_modelfile(
    modelfile_path: str,
    model_source: str,  # either a GGUF path or the merged HF dir
    ollama_model_name: str,
    using_gguf: bool
) -> None:
    if using_gguf:
        from_line = f"FROM {model_source}"
    else:
        # Without GGUF, create a Modelfile that won't directly work with Ollama
        # but documents what needs to happen
        from_line = f"# FROM {model_source}  (convert to GGUF first with llama.cpp)"

    content = f"""{from_line}

SYSTEM \"\"\"{STUDENT_SYSTEM_PROMPT}\"\"\"

PARAMETER temperature 0.3
PARAMETER top_p 0.9
PARAMETER stop "<|im_end|>"
PARAMETER stop "<|endoftext|>"
"""

    Path(modelfile_path).parent.mkdir(parents=True, exist_ok=True)
    with open(modelfile_path, "w", encoding="utf-8") as f:
        f.write(content)

    print(f"[merge_lora] Modelfile written to {modelfile_path}", flush=True)
    if not using_gguf:
        print(
            "[merge_lora] NOTE: GGUF conversion skipped. Convert the merged model to GGUF with "
            "llama.cpp, then update the FROM line in the Modelfile before running:\n"
            f"  ollama create {ollama_model_name} -f {modelfile_path}",
            flush=True
        )
    else:
        print(
            f"[merge_lora] To register with Ollama:\n"
            f"  ollama create {ollama_model_name} -f {modelfile_path}",
            flush=True
        )


def main() -> None:
    args = parse_args()

    missing = check_dependencies()
    report: dict = {
        "adapterPath": args.adapter_path,
        "baseModel": args.base_model,
        "mergedOutputDir": args.merged_output_dir,
        "modelfilePath": args.modelfile_path,
        "ollamaModelName": args.ollama_model_name,
        "missingDependencies": missing,
    }

    if args.dry_run:
        report["ready"] = len(missing) == 0 and Path(args.adapter_path).exists()
        print(json.dumps(report, indent=2))
        if args.report_file:
            Path(args.report_file).parent.mkdir(parents=True, exist_ok=True)
            with open(args.report_file, "w", encoding="utf-8") as f:
                json.dump(report, f, indent=2)
        return

    if missing:
        fail(f"Missing Python dependencies: {', '.join(missing)}. Install them first.")

    if not Path(args.adapter_path).exists():
        fail(f"Adapter path does not exist: {args.adapter_path}")

    # Step 1: Merge adapter into base model
    merge_adapter(args.base_model, args.adapter_path, args.merged_output_dir)

    # Step 2: Optionally convert to GGUF
    gguf_path = args.gguf_output_path
    gguf_ok = False

    if args.llama_cpp_dir and gguf_path:
        gguf_ok = try_convert_to_gguf(args.merged_output_dir, gguf_path, args.llama_cpp_dir)
    elif args.gguf_output_path:
        print("[merge_lora] --gguf_output_path specified but --llama_cpp_dir not provided — skipping GGUF conversion", flush=True)

    # Step 3: Write Modelfile
    model_source = gguf_path if gguf_ok and gguf_path else args.merged_output_dir
    write_modelfile(args.modelfile_path, model_source, args.ollama_model_name, gguf_ok)

    report["merged"] = True
    report["ggufConverted"] = gguf_ok
    report["ggufPath"] = gguf_path if gguf_ok else None
    report["modelfilePath"] = args.modelfile_path
    report["ready"] = True

    print(json.dumps(report, indent=2))
    if args.report_file:
        Path(args.report_file).parent.mkdir(parents=True, exist_ok=True)
        with open(args.report_file, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        raise
