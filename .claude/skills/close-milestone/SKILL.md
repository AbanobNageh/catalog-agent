---
name: close-milestone
description: Close a milestone (M0–M8) in this repo - verify the Done-when checks, run the fresh review, give the tour, write the milestone note, commit after the user's yes, tick docs/STATUS.md and log the experiment. Use when a milestone's work is finished and it's time for its Done-when check.
---
# Close a milestone

Do the steps in order. Stop at any failed check.

1. **Verify "Done when".** Take each item from the milestone's row in `REQUIREMENTS.md` §7 and from its plan in `docs/milestones/`, and show evidence: command output, test results, or what the user confirmed. Run the checks live (the real stack, the real stdio server), not only the unit tests. If anything fails, say so plainly, update "Now" in `docs/STATUS.md`, and stop. It isn't done.
2. **Fresh review**, if it hasn't run yet: a new agent, given only the plan (with its Review Focus) and the whole uncommitted diff (`git status`, `git diff`, and the new files), never this session's reasoning. Re-grade each finding by its real effect, fix the ones that matter (test-first for code), and record every ruling.
3. **The tour:** the files built, the key decisions and the MCP or agent-loop concepts they use, briefly enough that the user could explain them in an interview. Wait for their review. Every change they ask for is a review finding.
4. **Write the note** at `docs/milestones/YYYY-MM-DD-<id>-<slug>.md` (for example `2026-10-26-M0-scaffold.md`):
   ```markdown
   # <id> <title>
   - Date: YYYY-MM-DD · Commits: <short hashes> · Plan: [<plan file>](<plan file>) · Design: <ADR links>
   ## What was built
   ## Decisions (link ADRs; the user's choices; the AI's rulings during the build)
   ## Review findings and corrections   <!-- the fresh reviewer's and the user's, and what changed -->
   ## Follow-ups
   ```
   Be honest in "Review findings" and include the AI's own mistakes. This section is the portfolio evidence that the user reviewed the AI's work, and the README's log of the AI's mistakes is built from it.
5. **Commit the work.** Before the first commit and before any publish: check that no `.env`, key or `traces/` file is staged. Propose the commit messages (Conventional Commits style, ending with the co-author trailer; one per plan task is fine) and commit only after the user says yes, with `git commit -F <file>`.
6. **Update `docs/STATUS.md`.** Tick the item: `[x] <id> <title> · YYYY-MM-DD · <commits> · [note](milestones/<file>.md)`, where `<commits>` is the work commit's short hash, or `<first>..<last>` when there are several. Rewrite "Now" to point at the next milestone. Don't touch other checklist items.
7. **Experiment log:** add one line to the log in `docs/ai-workflow.md` saying what the context system helped with or got wrong during this milestone.
8. **Commit the close:** the note, the STATUS update and the log line together, as `docs: close <id>`.
9. **Release milestones (M4, M8):** run gitleaks over the whole history, then stop. Creating the GitHub repo, pushing and tagging a pushed release are the user's, after their go-ahead in that moment.
10. **End of a phase (after M4, M8):** propose cuts to `AGENTS.md`. Cut any line the model would follow anyway or that the code now shows. The user approves each cut.
11. Suggest `/clear` before the next milestone.
