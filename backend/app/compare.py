"""Ask the same questions to several LLMs and write their answers side by side in a Markdown report.

    uv run python -m app.compare gemma4:12b qwen3.5:9b --questions data/demo_questions.json

The questions file is a list of {"language": "bn", "question": "...", "meaning": "...", "follow_up": [...]}.
Follow-up questions, strings or {"question", "meaning"} objects, are asked in the same session, to
check the conversation memory. "meaning" is an optional Italian translation shown in the report.
"""

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

from .config import BACKEND_DIR, Settings
from .index import load_index
from .ollama import Ollama
from .rag import RagPipeline
from .sessions import SessionStore


async def ask_all(settings: Settings, questions: list[dict]) -> list[dict]:
    llm = Ollama(settings.ollama_url, settings.keep_alive)
    rag = RagPipeline(settings, llm, load_index(settings.index_dir), SessionStore(3600, settings.history_turns))
    await rag.warmup()
    results = []
    try:
        for number, item in enumerate(questions):
            follow_ups = [f if isinstance(f, dict) else {"question": f} for f in item.get("follow_up", [])]
            for turn in [item, *follow_ups]:
                question = turn["question"]
                started = time.perf_counter()
                first_token = None
                text: list[str] = []
                sources: dict = {}
                async for event in rag.answer(question, item["language"], f"compare-{number}", "/files"):
                    if event["type"] == "token":
                        first_token = first_token or time.perf_counter() - started
                        text.append(event["text"])
                    elif event["type"] == "sources":
                        sources = event
                results.append(
                    {
                        "language": item["language"],
                        "question": question,
                        "meaning": turn.get("meaning"),
                        "answer": "".join(text).strip(),
                        "sources": [s["title"] for s in sources.get("sources", [])],
                        "first_token": first_token or 0.0,
                        "total": time.perf_counter() - started,
                    }
                )
                print(f"{settings.llm_model} [{item['language']}] {results[-1]['total']:.1f}s  {question[:60]}")
    finally:
        await llm.aclose()
    return results


def report(by_model: dict[str, list[dict]]) -> str:
    models = list(by_model)
    lines = ["# Model comparison", "", f"Generated on {time.strftime('%Y-%m-%d %H:%M')}.", ""]
    lines += ["| Model | Average first token | Average total |", "| --- | --- | --- |"]
    for model, results in by_model.items():
        first = sum(r["first_token"] for r in results) / len(results)
        total = sum(r["total"] for r in results) / len(results)
        lines.append(f"| {model} | {first:.1f}s | {total:.1f}s |")
    for i, first_result in enumerate(by_model[models[0]]):
        lines += ["", f"## {i + 1}. [{first_result['language']}] {first_result['question']}"]
        if first_result["meaning"]:
            lines += ["", f"*{first_result['meaning']}*"]
        for model in models:
            result = by_model[model][i]
            lines += [
                "",
                f"**{model}** ({result['first_token']:.1f}s to first token, {result['total']:.1f}s total)",
                "",
                *[f"> {line}" if line else ">" for line in result["answer"].splitlines()],
                "",
                f"Sources: {', '.join(result['sources']) or 'none'}",
            ]
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare LLMs on the same questions.")
    parser.add_argument("models", nargs="+", help="Ollama model names, e.g. gemma4:12b qwen3.5:9b")
    parser.add_argument("--questions", type=Path, default=BACKEND_DIR / "data" / "demo_questions.json")
    parser.add_argument("--out", type=Path, default=BACKEND_DIR / "reports" / f"compare-{time.strftime('%Y%m%d-%H%M')}.md")
    args = parser.parse_args()
    # Progress lines show questions in any script: Windows uses a legacy code page when redirected.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    questions = json.loads(args.questions.read_text(encoding="utf-8"))
    by_model = {model: asyncio.run(ask_all(Settings(llm_model=model), questions)) for model in args.models}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(report(by_model), encoding="utf-8")
    print(f"Report written to {args.out}")


if __name__ == "__main__":
    main()
