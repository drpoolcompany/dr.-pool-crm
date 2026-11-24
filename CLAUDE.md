# Dr. Pool Staff repo: how to work here
Owner: Daniel (daniel@drpool.us). One folder per app: board/ crm/ whatsapp/ brain/ prospects/ tally/ (+ shared/drpool.js, root index.html launcher).
Each app has its own brief in <folder>/CLAUDE.md and its own subagent (.claude/agents/<folder>-pm.md).
Rules: work on one app at a time; run apps in parallel only on different folders; edit the repo first, then rebuild that app's mirror artifact; push to main only when Daniel says so; check Supabase RLS before shipping changes to new tables/columns.
Separate repos (not in this one): drpoolcompany/email-inbox-board, drpoolcompany/Agreement-board.
