# catalog-agent

@AGENTS.md
@docs/STATUS.md

## Claude Code notes
- At each "Done when" check, invoke the `close-milestone` skill.
- Plans written by planning skills (for example superpowers `writing-plans`) go in `docs/milestones/` as `YYYY-MM-DD-<id>-plan.md`, not in the skill's default folder.
- The fresh reviewer at each close is a new agent (Agent tool) given the uncommitted diff and the plan's Review Focus, never this session's reasoning.
- When compacting, preserve: the current milestone, the next step, open review findings, the plan's ledger of rulings, and any unchecked "Done when" items.
