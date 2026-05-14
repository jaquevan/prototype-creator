#!/usr/bin/env python3
"""
Publish a prototype to a target system.

Usage:
    python3 scripts/publish.py <prototype-id> --target <apollo|repo|local> [options]

Targets:
    apollo  — POST to Apollo REST API (requires APOLLO_URL, default http://localhost:1225)
    repo    — Initialize git repo in prototype folder, commit, and optionally push
    local   — Mark as submitted in metadata (no external action)

Options:
    --apollo-url URL    Apollo server URL (default: http://localhost:1225)
    --remote URL        Git remote URL for --target=repo
    --dry-run           Validate without writing externally
"""

import sys
import os
import json
import datetime
import urllib.request
import urllib.error
import subprocess


def publish_to_apollo(prototype_dir, apollo_url='http://localhost:1225', dry_run=False):
    artifact_root = os.path.dirname(prototype_dir)
    metadata_file = os.path.join(artifact_root, 'metadata.json')
    if not os.path.exists(metadata_file):
        print(f'Error: No metadata.json in {prototype_dir}', file=sys.stderr)
        sys.exit(1)

    with open(metadata_file, 'r') as f:
        metadata = json.load(f)

    payload = {
        'name': metadata.get('name', ''),
        'description': metadata.get('description', ''),
    }

    if dry_run:
        print(f'[DRY RUN] Would POST to {apollo_url}/api/prototypes:')
        print(json.dumps(payload, indent=2))
        return {'url': f'{apollo_url}/prototypes/{metadata.get("id", "unknown")}', 'dry_run': True}

    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f'{apollo_url}/api/prototypes',
        data=data,
        headers={'Content-Type': 'application/json'},
        method='POST'
    )

    try:
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode())
            print(f'Published to Apollo: {apollo_url}/prototypes/{result.get("id", "")}')
            return result
    except urllib.error.HTTPError as e:
        print(f'Error publishing to Apollo: {e.code} {e.reason}', file=sys.stderr)
        body = e.read().decode() if e.readable() else ''
        if body:
            print(body, file=sys.stderr)
        sys.exit(1)


def publish_to_repo(prototype_dir, remote=None, dry_run=False):
    if dry_run:
        print(f'[DRY RUN] Would initialize git repo in {prototype_dir}')
        if remote:
            print(f'[DRY RUN] Would push to {remote}')
        return {'target': 'repo', 'dry_run': True}

    subprocess.run(['git', 'init'], cwd=prototype_dir, check=True, capture_output=True)
    subprocess.run(['git', 'add', '.'], cwd=prototype_dir, check=True, capture_output=True)
    subprocess.run(
        ['git', 'commit', '-m', 'Initial prototype'],
        cwd=prototype_dir, check=True, capture_output=True
    )

    if remote:
        subprocess.run(
            ['git', 'remote', 'add', 'origin', remote],
            cwd=prototype_dir, check=True, capture_output=True
        )
        subprocess.run(
            ['git', 'push', '-u', 'origin', 'main'],
            cwd=prototype_dir, check=True, capture_output=True
        )
        print(f'Pushed to {remote}')

    return {'target': 'repo', 'remote': remote}


def publish_local(prototype_dir):
    artifact_root = os.path.dirname(prototype_dir)
    metadata_file = os.path.join(artifact_root, 'metadata.json')
    if os.path.exists(metadata_file):
        with open(metadata_file, 'r') as f:
            metadata = json.load(f)
        metadata['submittedAt'] = datetime.datetime.utcnow().isoformat() + 'Z'
        with open(metadata_file, 'w') as f:
            json.dump(metadata, f, indent=2)
    print(f'Marked as submitted locally: {prototype_dir}')
    return {'target': 'local'}


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    prototype_id = sys.argv[1]
    target = 'local'
    apollo_url = os.environ.get('APOLLO_URL', 'http://localhost:1225')
    remote = None
    dry_run = False

    i = 2
    while i < len(sys.argv):
        if sys.argv[i] == '--target' and i + 1 < len(sys.argv):
            target = sys.argv[i + 1]
            i += 2
        elif sys.argv[i] == '--apollo-url' and i + 1 < len(sys.argv):
            apollo_url = sys.argv[i + 1]
            i += 2
        elif sys.argv[i] == '--remote' and i + 1 < len(sys.argv):
            remote = sys.argv[i + 1]
            i += 2
        elif sys.argv[i] == '--dry-run':
            dry_run = True
            i += 1
        else:
            i += 1

    prototype_dir = f'.artifacts/{prototype_id}/prototype'
    metadata_dir = f'.artifacts/{prototype_id}'
    if not os.path.exists(prototype_dir):
        print(f'Error: Prototype not found: {prototype_id}', file=sys.stderr)
        sys.exit(1)

    if target == 'apollo':
        result = publish_to_apollo(prototype_dir, apollo_url, dry_run)
    elif target == 'repo':
        result = publish_to_repo(prototype_dir, remote, dry_run)
    elif target == 'local':
        result = publish_local(prototype_dir)
    else:
        print(f'Unknown target: {target}', file=sys.stderr)
        sys.exit(1)

    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
