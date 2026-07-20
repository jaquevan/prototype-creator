#!/usr/bin/env python3
"""
amplitude-funnel-probe.py

Probes Amplitude's documented Funnels endpoint directly over REST — no MCP
dependency, since no Amplitude MCP plugin is installed in this environment
as of 2026-07-20 (see ../README.md).

Endpoint: GET https://amplitude.com/api/2/funnels
Docs: https://amplitude.com/docs/apis/analytics/dashboard-rest#funnel-analysis

Auth: HTTP Basic, api_key as username, secret_key as password.
Credentials: AMPLITUDE_API_KEY / AMPLITUDE_SECRET_KEY env vars (request
access from Yahav — see README.md "Blocker: no Amplitude MCP plugin").

This does NOT probe Journeys (Pathfinder / Journey Map) — Amplitude has no
documented direct-export endpoint for that chart type. See README.md for
why the "save to a report first" workaround likely doesn't help either.

Usage:
    python3 amplitude-funnel-probe.py \\
        --events "evaluations benchmark run selected,mlflow experiment created" \\
        --start 20260701 --end 20260720 \\
        [--mode ordered|unordered|sequential] \\
        [--eu]

Exits non-zero with a clear message if credentials are missing, rather
than silently falling back to mock data — the caller (SKILL.md Step 2)
is responsible for choosing the sample fallback.
"""

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
import base64


US_HOST = "https://amplitude.com"
EU_HOST = "https://analytics.eu.amplitude.com"


def parse_args():
    p = argparse.ArgumentParser(description="Probe Amplitude's /api/2/funnels endpoint")
    p.add_argument("--events", required=True,
                   help="Comma-separated event names, in funnel step order")
    p.add_argument("--start", required=True, help="YYYYMMDD")
    p.add_argument("--end", required=True, help="YYYYMMDD")
    p.add_argument("--mode", default="ordered", choices=["ordered", "unordered", "sequential"])
    p.add_argument("--conversion-window-seconds", type=int, default=2592000,
                   help="Default 30 days, matches Amplitude's default")
    p.add_argument("--eu", action="store_true", help="Use the EU data residency host")
    p.add_argument("--out", default=None, help="Write raw JSON response to this path")
    return p.parse_args()


def build_event_params(events):
    """Amplitude expects repeated e=<json> params, one per funnel step."""
    params = []
    for name in events:
        event_obj = {"event_type": name}
        params.append(("e", json.dumps(event_obj)))
    return params


def main():
    args = parse_args()

    api_key = os.environ.get("AMPLITUDE_API_KEY")
    secret_key = os.environ.get("AMPLITUDE_SECRET_KEY")
    if not api_key or not secret_key:
        print(
            "FATAL: AMPLITUDE_API_KEY / AMPLITUDE_SECRET_KEY not set.\n"
            "This is the access blocker documented in README.md — request\n"
            "Amplitude API credentials from Yahav before running this probe.\n"
            "Falling back to samples/sample-journey-funnel.json is expected\n"
            "for this investigation until access is granted.",
            file=sys.stderr,
        )
        sys.exit(1)

    events = [e.strip() for e in args.events.split(",") if e.strip()]
    if len(events) < 2:
        print("FATAL: need at least 2 events to define a funnel.", file=sys.stderr)
        sys.exit(1)

    host = EU_HOST if args.eu else US_HOST
    params = build_event_params(events)
    params += [
        ("start", args.start),
        ("end", args.end),
        ("mode", args.mode),
        ("cs", str(args.conversion_window_seconds)),
    ]
    query = urllib.parse.urlencode(params)
    url = f"{host}/api/2/funnels?{query}"

    auth = base64.b64encode(f"{api_key}:{secret_key}".encode()).decode()
    req = urllib.request.Request(url, headers={"Authorization": f"Basic {auth}"})

    print(f"[amplitude-funnel-probe] GET {host}/api/2/funnels ({args.mode}, {len(events)} steps)",
          file=sys.stderr)

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read()
            status = resp.status
    except urllib.error.HTTPError as e:
        print(f"FATAL: HTTP {e.code} from Amplitude — {e.read().decode(errors='replace')}",
              file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"FATAL: network error reaching Amplitude — {e}", file=sys.stderr)
        sys.exit(1)

    data = json.loads(body)
    print(f"[amplitude-funnel-probe] HTTP {status} — {len(body)} bytes", file=sys.stderr)

    if args.out:
        with open(args.out, "w") as f:
            json.dump(data, f, indent=2)
        print(f"[amplitude-funnel-probe] wrote {args.out}", file=sys.stderr)
    else:
        print(json.dumps(data, indent=2))

    print(
        "\nNEXT STEP: paste the actual response shape into README.md under\n"
        "'Live probe results' — do not assume it matches samples/sample-journey-funnel.json\n"
        "until this has actually been run against a real project.",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
