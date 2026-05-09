import argparse
import importlib.util
import json
import os
import sys
import traceback
from pathlib import Path


def fail(message: str, code: int = 2) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(code)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train a short governed LoRA for the Hydria local student.")
    parser.add_argument("--base_model", required=True)
    parser.add_argument("--train_file", required=True)
    parser.add_argument("--output_dir", required=True)
    parser.add_argument("--num_train_epochs", type=int, default=1)
    parser.add_argument("--learning_rate", type=float, default=2e-4)
    parser.add_argument("--per_device_train_batch_size", type=int, default=1)
    parser.add_argument("--gradient_accumulation_steps", type=int, default=16)
    parser.add_argument("--max_seq_length", type=int, default=1536)
    parser.add_argument("--lora_r", type=int, default=16)
    parser.add_argument("--lora_alpha", type=int, default=32)
    parser.add_argument("--lora_dropout", type=float, default=0.05)
    parser.add_argument("--max_train_samples", type=int, default=None)
    parser.add_argument("--logging_steps", type=int, default=10)
    parser.add_argument("--save_steps", type=int, default=100)
    parser.add_argument("--warmup_ratio", type=float, default=0.03)
    parser.add_argument("--load_in_4bit", action="store_true")
    parser.add_argument("--gradient_checkpointing", action="store_true")
    parser.add_argument("--dry_run", action="store_true")
    parser.add_argument("--prepare_only", action="store_true")
    parser.add_argument("--expand_weighted_samples", action="store_true")
    parser.add_argument("--report_file", default=None)
    return parser.parse_args()


def check_dependencies(load_in_4bit: bool):
    missing = []
    required = ["torch", "transformers", "datasets", "peft", "accelerate"]
    if load_in_4bit:
        required.append("bitsandbytes")
    for name in required:
        if importlib.util.find_spec(name) is None:
            missing.append(name)
    return missing


def load_python_env_report():
    report = {
        "python": sys.version.splitlines()[0],
        "cuda_available": False,
        "gpu_name": None,
        "torch": None,
    }
    try:
        import torch

        report["torch"] = getattr(torch, "__version__", None)
        report["cuda_available"] = bool(torch.cuda.is_available())
        if report["cuda_available"]:
            report["gpu_name"] = torch.cuda.get_device_name(0)
    except Exception:
        pass
    return report


def read_examples(train_file: str):
    examples = []
    with open(train_file, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            examples.append(json.loads(line))
    return examples


def expand_weighted_examples(examples):
    expanded = []
    for example in examples:
        try:
            repeat_count = int(float(example.get("weight", 1)))
        except Exception:
            repeat_count = 1
        repeat_count = max(1, repeat_count)
        expanded.extend([example] * repeat_count)
    return expanded


def write_report(path: str | None, payload: dict):
    if not path:
        return
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")


def prompt_messages(example):
    # targetAnswer is the supervised assistant response. Some historical
    # examples also store an assistant message, so remove assistant turns from
    # the prompt before appending the canonical target.
    return [message for message in example["messages"] if message.get("role") != "assistant"]


def format_training_texts(example, tokenizer):
    messages = prompt_messages(example)
    full_messages = messages + [{"role": "assistant", "content": example["targetAnswer"]}]
    if hasattr(tokenizer, "apply_chat_template"):
        prompt_text = tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
        )
        full_text = tokenizer.apply_chat_template(
            full_messages,
            tokenize=False,
            add_generation_prompt=False,
        )
        return prompt_text, full_text

    # Minimal fallback if the tokenizer has no chat template.
    prompt_rendered = []
    for message in messages:
        prompt_rendered.append(f"{message['role'].upper()}: {message['content']}")
    prompt_rendered.append("ASSISTANT:")

    rendered = []
    for message in full_messages:
        rendered.append(f"{message['role'].upper()}: {message['content']}")
    return "\n".join(prompt_rendered), "\n".join(rendered)


def tokenize_training_example(example, tokenizer, max_seq_length: int):
    prompt_text, full_text = format_training_texts(example, tokenizer)
    encoded = tokenizer(
        full_text,
        truncation=True,
        max_length=max_seq_length,
        add_special_tokens=False,
    )
    prompt_encoded = tokenizer(
        prompt_text,
        truncation=True,
        max_length=max_seq_length,
        add_special_tokens=False,
    )

    input_ids = list(encoded["input_ids"])
    attention_mask = list(encoded.get("attention_mask", [1] * len(input_ids)))
    prompt_token_count = min(len(prompt_encoded["input_ids"]), len(input_ids))
    labels = [-100] * prompt_token_count + input_ids[prompt_token_count:]
    supervised_token_count = sum(1 for label in labels if label != -100)

    return {
        "input_ids": input_ids,
        "attention_mask": attention_mask,
        "labels": labels,
        "promptTokenCount": prompt_token_count,
        "supervisedTokenCount": supervised_token_count,
    }


def train(args: argparse.Namespace):
    missing = check_dependencies(args.load_in_4bit)
    env_report = load_python_env_report()
    raw_dataset_examples = read_examples(args.train_file)
    dataset_examples = (
        expand_weighted_examples(raw_dataset_examples)
        if args.expand_weighted_samples
        else raw_dataset_examples
    )
    if args.max_train_samples is not None:
        dataset_examples = dataset_examples[: args.max_train_samples]

    report = {
        "baseModel": args.base_model,
        "trainFile": os.path.abspath(args.train_file),
        "outputDir": os.path.abspath(args.output_dir),
        "sampleCount": len(dataset_examples),
        "rawSampleCount": len(raw_dataset_examples),
        "weightedExpansionEnabled": bool(args.expand_weighted_samples),
        "loadIn4Bit": args.load_in_4bit,
        "environment": env_report,
        "missingDependencies": missing,
    }

    if args.dry_run:
        report["ready"] = len(missing) == 0 and len(dataset_examples) > 0
        print(json.dumps(report, indent=2))
        write_report(args.report_file, report)
        return

    if missing:
        fail(
            "Missing Python dependencies for local student LoRA: "
            + ", ".join(missing)
            + ". Install them first, or rerun with --dry_run."
        )

    if not dataset_examples:
        fail("Training dataset is empty.")

    try:
        import torch
        from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
        from transformers import (
            AutoModelForCausalLM,
            AutoTokenizer,
            BitsAndBytesConfig,
            Trainer,
            TrainingArguments,
        )
    except Exception as exc:  # pragma: no cover
        fail(f"Failed to import training stack: {exc}")

    Path(args.output_dir).mkdir(parents=True, exist_ok=True)
    print("stage=load_tokenizer", flush=True)
    tokenizer = AutoTokenizer.from_pretrained(args.base_model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"
    tokenizer.model_max_length = args.max_seq_length

    model_kwargs = {"trust_remote_code": True}
    if args.load_in_4bit:
        print("stage=load_model_4bit", flush=True)
        model_kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=torch.float16,
        )
        model_kwargs["device_map"] = "auto"
        model = AutoModelForCausalLM.from_pretrained(args.base_model, **model_kwargs)
        print("stage=model_loaded", flush=True)
        model = prepare_model_for_kbit_training(model)
        print("stage=kbit_prepared", flush=True)
    else:
        print("stage=load_model_full", flush=True)
        model_kwargs["torch_dtype"] = torch.float16 if torch.cuda.is_available() else torch.float32
        model_kwargs["device_map"] = "auto" if torch.cuda.is_available() else None
        model = AutoModelForCausalLM.from_pretrained(args.base_model, **model_kwargs)
        print("stage=model_loaded", flush=True)

    lora_config = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=args.lora_dropout,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=[
            "q_proj",
            "k_proj",
            "v_proj",
            "o_proj",
            "gate_proj",
            "up_proj",
            "down_proj",
        ],
    )
    print("stage=build_lora", flush=True)
    model = get_peft_model(model, lora_config)
    print("stage=lora_attached", flush=True)
    model.config.use_cache = False
    if args.gradient_checkpointing:
        print("stage=enable_gradient_checkpointing", flush=True)
        model.gradient_checkpointing_enable()
        model.enable_input_require_grads()

    print("stage=tokenize_dataset", flush=True)
    tokenized = []
    skipped_no_target_count = 0
    prompt_token_counts = []
    supervised_token_counts = []
    for example in dataset_examples:
        encoded = tokenize_training_example(example, tokenizer, args.max_seq_length)
        supervised_token_count = encoded.pop("supervisedTokenCount")
        prompt_token_count = encoded.pop("promptTokenCount")
        if supervised_token_count <= 0:
            skipped_no_target_count += 1
            continue
        supervised_token_counts.append(supervised_token_count)
        prompt_token_counts.append(prompt_token_count)
        tokenized.append(encoded)
    print("stage=dataset_tokenized", flush=True)
    if not tokenized:
        fail("No trainable target tokens remained after prompt masking.")

    tokenization_report = {
        "tokenizedCount": len(tokenized),
        "skippedNoTargetCount": skipped_no_target_count,
        "averagePromptTokens": round(sum(prompt_token_counts) / len(prompt_token_counts), 1),
        "averageSupervisedTokens": round(
            sum(supervised_token_counts) / len(supervised_token_counts),
            1,
        ),
    }
    report["tokenization"] = tokenization_report

    pad_token_id = tokenizer.pad_token_id if tokenizer.pad_token_id is not None else tokenizer.eos_token_id

    def collator(features):
        max_length = max(len(feature["input_ids"]) for feature in features)
        batch = {
            "input_ids": [],
            "attention_mask": [],
            "labels": [],
        }
        for feature in features:
            pad_length = max_length - len(feature["input_ids"])
            batch["input_ids"].append(feature["input_ids"] + [pad_token_id] * pad_length)
            batch["attention_mask"].append(feature["attention_mask"] + [0] * pad_length)
            batch["labels"].append(feature["labels"] + [-100] * pad_length)

        return {
            key: torch.tensor(value, dtype=torch.long)
            for key, value in batch.items()
        }

    class TokenizedDataset(torch.utils.data.Dataset):
        def __init__(self, items):
            self.items = items

        def __len__(self):
            return len(self.items)

        def __getitem__(self, idx):
            return self.items[idx]

    train_dataset = TokenizedDataset(tokenized)

    print("stage=build_trainer", flush=True)
    training_args = TrainingArguments(
        output_dir=args.output_dir,
        num_train_epochs=args.num_train_epochs,
        learning_rate=args.learning_rate,
        per_device_train_batch_size=args.per_device_train_batch_size,
        gradient_accumulation_steps=args.gradient_accumulation_steps,
        warmup_ratio=args.warmup_ratio,
        logging_steps=args.logging_steps,
        save_steps=args.save_steps,
        save_total_limit=1,
        report_to="none",
        bf16=False,
        fp16=bool(torch.cuda.is_available()),
        optim="paged_adamw_8bit" if args.load_in_4bit else "adamw_torch",
        dataloader_num_workers=0,
        remove_unused_columns=False,
        do_train=True,
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        data_collator=collator,
    )
    if args.prepare_only:
        final_report = {
            **report,
            "ready": True,
            "prepared": True,
        }
        print(json.dumps(final_report, indent=2))
        write_report(args.report_file, final_report)
        return

    print("stage=train", flush=True)
    train_result = trainer.train()
    print("stage=save", flush=True)
    trainer.save_model(args.output_dir)
    tokenizer.save_pretrained(args.output_dir)

    final_report = {
        **report,
        "ready": True,
        "trainLoss": float(train_result.training_loss),
        "globalSteps": int(getattr(trainer.state, "global_step", 0)),
    }
    print(json.dumps(final_report, indent=2))
    write_report(args.report_file, final_report)


if __name__ == "__main__":
    try:
        train(parse_args())
    except Exception:
        traceback.print_exc()
        raise
