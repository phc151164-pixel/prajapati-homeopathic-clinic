#!/usr/bin/env python3
"""Generate a local OCR draft and compare each sampled page with human transcription."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
import unicodedata


def normalize(text):
    return " ".join(unicodedata.normalize("NFC", text).split())


def edit_distance(actual, expected):
    previous = list(range(len(expected) + 1))
    for index, character in enumerate(actual, 1):
        current = [index]
        for position, reference in enumerate(expected, 1):
            current.append(min(
                current[-1] + 1, previous[position] + 1,
                previous[position - 1] + (character != reference),
            ))
        previous = current
    return previous[-1]


def recognize(pdf, page):
    with tempfile.TemporaryDirectory() as folder:
        prefix = Path(folder) / "page"
        subprocess.run([
            "pdftoppm", "-f", str(page), "-l", str(page), "-r", "300",
            "-gray", "-png", "-singlefile", str(pdf), str(prefix),
        ], check=True, timeout=120)
        result = subprocess.run([
            "tesseract", str(prefix.with_suffix(".png")), "stdout", "-l", "hin+eng",
        ], check=True, capture_output=True, text=True, timeout=120)
        return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("review", type=Path, help="Manually verified rights record and reference samples")
    parser.add_argument("output", type=Path, help="New directory for local OCR drafts and metrics")
    args = parser.parse_args()
    record = json.loads(args.review.read_text(encoding="utf-8"))
    evidence = record.get("rights_evidence")
    if record.get("full_text_import_allowed") is not True or not isinstance(evidence, str) or not evidence.strip():
        parser.error("Rights clearance and edition-specific evidence are required.")
    with args.pdf.open("rb") as pdf:
        digest = hashlib.file_digest(pdf, "sha256").hexdigest()
    if digest != record.get("sha256"):
        parser.error("The PDF does not match the rights review record.")
    samples = record.get("samples", {})
    if not isinstance(samples, dict) or len(samples) < 3 or any(
        not re.fullmatch(r"[1-9][0-9]{0,4}", page)
        or not isinstance(text, str) or len(normalize(text)) < 30
        or not re.search(r"[\u0900-\u097f]", text)
        for page, text in samples.items()
    ):
        parser.error("Provide independently transcribed Hindi text for at least three representative pages.")
    languages = subprocess.check_output(["tesseract", "--list-langs"], text=True).splitlines()
    if not {"hin", "eng"}.issubset(languages):
        parser.error("Install the Tesseract hin and eng language packs.")
    args.output.mkdir()
    metrics = []
    for page, reference in sorted(samples.items(), key=lambda item: int(item[0])):
        draft = recognize(args.pdf.resolve(), int(page))
        (args.output / f"page-{page}.txt").write_text(draft, encoding="utf-8")
        expected = normalize(reference)
        distance = edit_distance(normalize(draft), expected)
        metrics.append({"page": int(page), "reference_characters": len(expected),
                        "edit_distance": distance, "character_error_rate": distance / len(expected)})
    report = {"sha256": digest, "pages": metrics,
              "weighted_character_error_rate": sum(item["edit_distance"] for item in metrics)
              / sum(item["reference_characters"] for item in metrics),
              "human_review_required": True}
    (args.output / "accuracy.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
