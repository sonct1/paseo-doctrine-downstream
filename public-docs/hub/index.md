---
title: Hub
description: The layer above your daemons. Register them, give them capabilities, and share them with your team.
nav: Overview
order: 60
category: Hub
---

# Hub

> **Paseo Foundation downstream:** the stable v0.5.0 guided starter is intentionally unavailable.
> Its Hub-to-daemon create request does not carry a revision-scoped assigner, role/assignment
> contract, Workspace Protocol admission receipt, or exact output grants. Manual Hub configuration
> remains available for explicitly reviewed compatibility workflows; `paseo hub init` fails closed
> before login, connection, file writes, or deployment.

A daemon runs agents on one machine, for you. Paseo Hub is the layer above your daemons. You register your daemons with it, and it gives them capabilities they do not have on their own.

```text
             Hub
    ┌─────────┼─────────┐
    ▼         ▼         ▼
 laptop    devbox    build server
```

What that gives you today:

- Agents that start on their own, from activity in GitHub, Slack, and Discord.
- Configuration that lives in a repository and deploys when you push.
- A record of everything that arrived, what it matched, and what ran.
- One place for your team to see all of it.

Your daemons keep running agents where they always did. Hub decides when to ask them to.

## What lives in your repository

Upstream v0.5.0 guided setup would create a project resource file for environments and agents, plus one starter workflow:

```text
.paseo/
├── hub.yml
└── workflows/
    └── slack-help.yml
```

This downstream keeps that shape documented as an adaptation target, but does not deploy it until
Hub and daemon negotiate the Foundation authority contract. The [generated starter bundle](/docs/hub/configuration#generated-starter-bundle)
shows the deferred upstream shape, while [Workflows](/docs/hub/workflows) covers manual routing,
prompt partials, and provider-specific replies.

## Reading order

1. [Quickstart](/docs/hub/quickstart)
2. [How it works](/docs/hub/concepts)
3. [Daemons](/docs/hub/daemons)
4. [Triggers](/docs/hub/triggers)
5. [Workflows](/docs/hub/workflows)
6. [GitHub access](/docs/hub/github)
7. [Configuration](/docs/hub/configuration)
8. [Security](/docs/hub/security)

If a workflow accepts requests from GitHub, Slack, Discord, or the API, read [Hub security](/docs/hub/security) before giving an agent access to a working directory or output capability.

## Run Hub yourself

Start on your machine with the embedded database, then add PostgreSQL or a public deployment only when you need them. [Self-hosting](/docs/hub/self-hosting) covers each step.

[Hosted Hub](/docs/hub/hosted) uses the same projects, workflows, daemons, and activity model. New account registration is currently closed.
