"""Tests for score_prototype.py aggregate scoring logic."""

import os
import tempfile
import json
import pytest

from score_prototype import score_prototype, PASS_THRESHOLD, MIN_PER_DIMENSION, DIMENSIONS


@pytest.fixture
def reviews_dir():
    d = tempfile.mkdtemp()
    yield d
    import shutil
    shutil.rmtree(d)


def write_review(reviews_dir, prototype_id, dimension, score):
    filepath = os.path.join(reviews_dir, f'{dimension}.md')
    verdict = 'pass' if score == 2 else 'partial' if score == 1 else 'fail'
    with open(filepath, 'w') as f:
        f.write(f'---\nprototype_id: {prototype_id}\ndimension: {dimension}\nscore: {score}\nverdict: {verdict}\nreviewed_at: 2026-04-30T00:00:00Z\n---\n\nReview content.\n')


def test_all_passing(reviews_dir):
    for dim in DIMENSIONS:
        write_review(reviews_dir, 'TEST-001', dim, 2)
    result = score_prototype('TEST-001', reviews_dir)
    assert result['total_score'] == 8
    assert result['verdict'] == 'rubric-pass'


def test_needs_attention_low_score(reviews_dir):
    write_review(reviews_dir, 'TEST-002', 'completeness', 1)
    write_review(reviews_dir, 'TEST-002', 'usability', 1)
    write_review(reviews_dir, 'TEST-002', 'feasibility', 1)
    write_review(reviews_dir, 'TEST-002', 'fidelity_match', 1)
    result = score_prototype('TEST-002', reviews_dir)
    assert result['total_score'] == 4
    assert result['verdict'] == 'needs-attention'


def test_needs_attention_has_zero(reviews_dir):
    write_review(reviews_dir, 'TEST-003', 'completeness', 2)
    write_review(reviews_dir, 'TEST-003', 'usability', 2)
    write_review(reviews_dir, 'TEST-003', 'feasibility', 0)
    write_review(reviews_dir, 'TEST-003', 'fidelity_match', 2)
    result = score_prototype('TEST-003', reviews_dir)
    assert result['total_score'] == 6
    assert result['verdict'] == 'needs-attention'


def test_borderline_pass(reviews_dir):
    write_review(reviews_dir, 'TEST-004', 'completeness', 2)
    write_review(reviews_dir, 'TEST-004', 'usability', 1)
    write_review(reviews_dir, 'TEST-004', 'feasibility', 2)
    write_review(reviews_dir, 'TEST-004', 'fidelity_match', 1)
    result = score_prototype('TEST-004', reviews_dir)
    assert result['total_score'] == 6
    assert result['verdict'] == 'rubric-pass'


def test_missing_dimension(reviews_dir):
    write_review(reviews_dir, 'TEST-005', 'completeness', 2)
    write_review(reviews_dir, 'TEST-005', 'usability', 2)
    result = score_prototype('TEST-005', reviews_dir)
    assert len(result['missing_dimensions']) == 2
    assert 'feasibility' in result['missing_dimensions']


def test_summary_file_created(reviews_dir):
    for dim in DIMENSIONS:
        write_review(reviews_dir, 'TEST-006', dim, 2)
    score_prototype('TEST-006', reviews_dir)
    summary_path = os.path.join(reviews_dir, 'summary.md')
    assert os.path.exists(summary_path)
