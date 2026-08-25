# Route work

Generic invented skill. Use when Helm owns intake and must hand work to another bot.

## When to use

- A request has a clear owner other than the orchestrator.
- The matching bot has a published description that covers the job.

## Required inputs

- Task summary
- Published descriptions of available crew bots
- Approval boundary for the task

## Sequence

1. Restate the outcome in one sentence.
2. Pick the specialist whose description matches the job.
3. Hand off the task with the required inputs and the approval boundary.
4. Record who owns the next step.

## Validate

- One owner, not several.
- No invented status when a source is missing.
- External send, spend, and production changes stay behind approval.

## Return

A short routing note: owner, next action, and anything still blocked.

## Approval

Never send external messages, spend money, or change production systems from this skill.
