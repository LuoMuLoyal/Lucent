"""Export a scoped subgraph and serve it in semantica's Knowledge Explorer.

This wraps the two steps documented in the README so the dev loop is one
command. It exists because the setup has three non-obvious requirements that are
easy to get wrong one at a time:

1. The Explorer needs ``SEMANTICA_ALLOW_ANONYMOUS=true`` or every route 503s —
   ``SEMANTICA_API_KEY`` is unset in development, and the Explorer refuses to
   serve unauthenticated rather than silently doing so.
2. It must bind to loopback. That flag makes the process fully unauthenticated,
   so exposing it is a real risk, not a theoretical one.
3. The frontend bundle lives in the installed package, not the fork source
   (see the README's "One-time setup").

Usage::

    uv run python scripts/serve_viz.py --drug Warfarin --drug Clopidogrel
    uv run python scripts/serve_viz.py --atc B01A --port 8011 --limit 800

Ctrl-C stops the server. The export file is left in place so the same slice can
be reopened without re-reading AGE.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import export_context_graph as exporter  # noqa: E402


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--drug", action="append", default=[], help="Drug name or id (repeatable).")
    parser.add_argument(
        "--atc", action="append", default=[], help="ATC level-4 prefix (repeatable)."
    )
    parser.add_argument("--limit", type=int, default=400, help="Nodes and edges to render.")
    parser.add_argument("--read-limit", type=int, default=60_000, help="Nodes and edges to read.")
    parser.add_argument("--port", type=int, default=8010, help="Explorer port.")
    parser.add_argument("--host", default="127.0.0.1", help="Bind address. Keep it on loopback.")
    parser.add_argument(
        "--include-atc-links",
        action="store_true",
        help="Also load IN_ATC_CLASS / SUBCLASS_OF edges.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.drug and not args.atc:
        print("Name a --drug or --atc scope.", file=sys.stderr)
        return 2

    export_args = ["--limit", str(args.limit), "--read-limit", str(args.read_limit)]
    for name in args.drug:
        export_args += ["--drug", name]
    for prefix in args.atc:
        export_args += ["--atc", prefix]
    if args.include_atc_links:
        export_args.append("--include-atc-links")

    code = exporter.main(export_args)
    if code != 0:
        return code

    out = exporter.DEFAULT_OUT / f"{exporter._scope_slug(args.drug, args.atc)}.json"

    env = dict(os.environ)
    # Loopback-only, so unauthenticated access is acceptable here and nowhere
    # else. The check is not decoration: the Explorer refuses to start serving
    # protected routes without a key OR this flag.
    env["SEMANTICA_ALLOW_ANONYMOUS"] = "true"
    command = [
        "uv",
        "run",
        "semantica-explorer",
        "--graph",
        str(out),
        "--host",
        args.host,
        "--port",
        str(args.port),
        "--no-browser",
    ]
    print(f"\nserving on http://{args.host}:{args.port}\n")
    try:
        return subprocess.call(command, cwd=REPO, env=env)
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
