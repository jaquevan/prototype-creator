"""Tests for resolve_workspace.py URL parsing and branch resolution."""

import os
import pytest

from resolve_workspace import parse_git_url, resolve_branch, is_git_url, resolve_workspace


class TestParseGitUrl:
    """URL parsing extracts branch and produces a cloneable URL."""

    def test_gitlab_tree_url(self):
        url = 'https://gitlab.example.com/org/prototypes/myapp/-/tree/3.5'
        clone_url, branch = parse_git_url(url)
        assert clone_url == 'https://gitlab.example.com/org/prototypes/myapp.git'
        assert branch == '3.5'

    def test_gitlab_tree_url_with_query_params(self):
        url = 'https://gitlab.example.com/org/prototypes/myapp/-/tree/3.5?ref_type=heads'
        clone_url, branch = parse_git_url(url)
        assert clone_url == 'https://gitlab.example.com/org/prototypes/myapp.git'
        assert branch == '3.5'

    def test_github_tree_url(self):
        url = 'https://github.com/openshift/console/tree/release-4.16'
        clone_url, branch = parse_git_url(url)
        assert clone_url == 'https://github.com/openshift/console.git'
        assert branch == 'release-4.16'

    def test_fragment_branch(self):
        url = 'https://gitlab.example.com/org/prototypes/myapp.git#3.5'
        clone_url, branch = parse_git_url(url)
        assert clone_url == 'https://gitlab.example.com/org/prototypes/myapp.git'
        assert branch == '3.5'

    def test_plain_https_url_no_branch(self):
        url = 'https://gitlab.example.com/org/prototypes/myapp.git'
        clone_url, branch = parse_git_url(url)
        assert clone_url == 'https://gitlab.example.com/org/prototypes/myapp.git'
        assert branch is None

    def test_plain_https_url_without_git_suffix(self):
        url = 'https://gitlab.example.com/org/prototypes/myapp'
        clone_url, branch = parse_git_url(url)
        assert clone_url == 'https://gitlab.example.com/org/prototypes/myapp.git'
        assert branch is None

    def test_ssh_url_no_branch(self):
        url = 'git@gitlab.example.com:org/prototypes/myapp.git'
        clone_url, branch = parse_git_url(url)
        assert clone_url == 'git@gitlab.example.com:org/prototypes/myapp.git'
        assert branch is None

    def test_gitlab_nested_group(self):
        url = 'https://gitlab.example.com/org/subgroup/repo/-/tree/feature/my-branch'
        clone_url, branch = parse_git_url(url)
        assert clone_url == 'https://gitlab.example.com/org/subgroup/repo.git'
        assert branch == 'feature/my-branch'

    def test_github_branch_with_slashes(self):
        url = 'https://github.com/org/repo/tree/feature/deep/branch'
        clone_url, branch = parse_git_url(url)
        assert clone_url == 'https://github.com/org/repo.git'
        assert branch == 'feature/deep/branch'


class TestResolveBranch:
    """Flag takes priority over URL-detected branch."""

    def test_flag_wins_over_url(self):
        branch, source = resolve_branch('main', '3.5')
        assert branch == '3.5'
        assert source == 'flag'

    def test_url_branch_used_when_no_flag(self):
        branch, source = resolve_branch('3.5', None)
        assert branch == '3.5'
        assert source == 'url'

    def test_no_branch_from_either(self):
        branch, source = resolve_branch(None, None)
        assert branch is None
        assert source is None

    def test_flag_only(self):
        branch, source = resolve_branch(None, 'develop')
        assert branch == 'develop'
        assert source == 'flag'


class TestIsGitUrl:
    """Distinguish git URLs from local paths."""

    def test_https(self):
        assert is_git_url('https://github.com/org/repo') is True

    def test_ssh(self):
        assert is_git_url('git@github.com:org/repo.git') is True

    def test_dot_git_suffix(self):
        assert is_git_url('gitlab.example.com/repo.git') is True

    def test_local_relative(self):
        assert is_git_url('.artifacts/foo/workspace') is False

    def test_local_absolute(self):
        assert is_git_url('/Users/someone/code/repo') is False


class TestResolveWorkspace:
    """Full resolution combining URL parsing, branch, and path logic."""

    def test_git_url_with_branch_in_url(self):
        result = resolve_workspace(
            'https://gitlab.example.com/org/prototypes/myapp/-/tree/3.5?ref_type=heads',
            rfe_key='PROJ-298',
        )
        assert result['type'] == 'git'
        assert result['clone_url'] == 'https://gitlab.example.com/org/prototypes/myapp.git'
        assert result['branch'] == '3.5'
        assert result['branch_source'] == 'url'
        assert result['clone_path'] == '.artifacts/PROJ-298/workspace'

    def test_git_url_with_flag_override(self):
        result = resolve_workspace(
            'https://gitlab.example.com/org/prototypes/myapp/-/tree/main',
            rfe_key='PROJ-298',
            branch_flag='3.5',
        )
        assert result['branch'] == '3.5'
        assert result['branch_source'] == 'flag'
        assert 'override_note' in result

    def test_git_url_no_branch(self):
        result = resolve_workspace(
            'git@gitlab.example.com:org/prototypes/myapp.git',
            rfe_key='PROJ-298',
        )
        assert result['type'] == 'git'
        assert result['branch'] is None
        assert result['branch_source'] is None

    def test_git_url_with_flag_only(self):
        result = resolve_workspace(
            'git@gitlab.example.com:org/prototypes/myapp.git',
            rfe_key='PROJ-298',
            branch_flag='3.5',
        )
        assert result['branch'] == '3.5'
        assert result['branch_source'] == 'flag'
        assert 'override_note' not in result

    def test_local_path_existing(self, tmp_path):
        result = resolve_workspace(str(tmp_path))
        assert result['type'] == 'local'
        assert result['exists'] is True

    def test_local_path_nonexistent(self):
        result = resolve_workspace('/nonexistent/path/to/nowhere')
        assert result['type'] == 'local'
        assert result['exists'] is False

    def test_local_path_ignores_branch_flag(self):
        result = resolve_workspace('/some/local/path', branch_flag='3.5')
        assert result['type'] == 'local'
        assert 'warning' in result
