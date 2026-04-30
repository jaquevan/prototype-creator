"""Tests for frontmatter.py read/write/schema operations."""

import os
import tempfile
import json
import pytest

from frontmatter import read_frontmatter, set_frontmatter, SCHEMAS


def test_read_empty_file():
    with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
        f.write('# No frontmatter\n\nJust content.')
        f.flush()
        result = read_frontmatter(f.name)
    os.unlink(f.name)
    assert result == {}


def test_read_with_frontmatter():
    content = '---\nprototype_id: PROJ-298\ntitle: Test Prototype\nstatus: draft\n---\n\n# Content'
    with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
        f.write(content)
        f.flush()
        result = read_frontmatter(f.name)
    os.unlink(f.name)
    assert result['prototype_id'] == 'PROJ-298'
    assert result['title'] == 'Test Prototype'
    assert result['status'] == 'draft'


def test_read_null_values():
    content = '---\nkey: null\n---\n'
    with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
        f.write(content)
        f.flush()
        result = read_frontmatter(f.name)
    os.unlink(f.name)
    assert result['key'] is None


def test_read_integer_values():
    content = '---\nscore: 2\niteration: 0\n---\n'
    with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
        f.write(content)
        f.flush()
        result = read_frontmatter(f.name)
    os.unlink(f.name)
    assert result['score'] == 2
    assert result['iteration'] == 0


def test_set_frontmatter_new():
    with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
        f.write('---\nstatus: draft\n---\n\n# Content here')
        f.flush()
        set_frontmatter(f.name, {'status': 'reviewed', 'score': '6'})
        result = read_frontmatter(f.name)
    os.unlink(f.name)
    assert result['status'] == 'reviewed'
    assert result['score'] == 6


def test_set_preserves_body():
    body = '\n# My Prototype\n\nThis is the body content.\n'
    with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
        f.write(f'---\nid: test\n---\n{body}')
        f.flush()
        set_frontmatter(f.name, {'id': 'updated'})
        with open(f.name, 'r') as rf:
            content = rf.read()
    os.unlink(f.name)
    assert body in content


def test_schemas_exist():
    assert 'prototype' in SCHEMAS
    assert 'review' in SCHEMAS
    assert 'decision' in SCHEMAS
    assert 'submission' in SCHEMAS


def test_prototype_schema_required_fields():
    schema = SCHEMAS['prototype']
    required = [k for k, v in schema.items() if v.get('required')]
    assert 'prototype_id' in required
    assert 'title' in required
    assert 'source_rfe' in required
    assert 'fidelity' in required


def test_review_schema_score_bounds():
    schema = SCHEMAS['review']
    assert schema['score']['min'] == 0
    assert schema['score']['max'] == 2
