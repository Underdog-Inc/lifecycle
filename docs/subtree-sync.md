# Monorepo Subtree Sync

This document describes the procedure for syncing the `backend/` and `frontend/`
subtrees from their respective source repositories into this monorepo.

## Overview

The `backend/` and `frontend/` directories in this repository are managed as
`git subtree` imports. When changes are merged to the original ("old") repos,
they must be synced here using the steps below.

## Prerequisites

- Write access to this repository
- Remote references configured for each source repo (see below)
- Coordinate a **merge freeze window** with the team before syncing

## Adding Subtree Remotes (one-time setup)

```bash
git remote add backend  <backend-repo-url>
git remote add frontend <frontend-repo-url>
git fetch backend
git fetch frontend
```

## Initial Subtree Import

If `backend/` or `frontend/` does not yet exist in the monorepo:

```bash
git subtree add --prefix=backend/  backend  main --squash
git subtree add --prefix=frontend/ frontend main --squash
```

## Syncing Latest Changes (DEVEX-67)

Run the following after announcing a merge freeze:

```bash
# Pull latest backend commits (squashed)
git subtree pull --prefix=backend/  backend  main --squash

# Pull latest frontend commits (squashed)
git subtree pull --prefix=frontend/ frontend main --squash
```

Resolve any merge conflicts, verify the build, then proceed with cutover.

## Post-Sync Verification

```bash
pnpm install
pnpm lint
pnpm test
pnpm build
```

## Notes

- Always use `--squash` to keep the monorepo history clean.
- Announce the merge freeze before syncing to avoid mid-sync commits in the
  source repos.
- After the sync is verified, lift the merge freeze and proceed with cutover.
