---
name: create-handoff-doc
description: Create handoff document for transferring work to another session. Use when user says "create handoff", "save my progress", "handoff this work", context is getting full (>50%), or ending session with incomplete work.
argument-hint: "(no args — uses current session context)"
---

# Create Handoff

You are tasked with writing a handoff document to hand off your work to another agent in a new session. You will create a handoff document that is thorough, but also **concise**. The goal is to compact and summarize your context without losing any of the key details of what you're working on.

## Process

### 1. Filepath & Metadata

Create your file under `thoughts/shared/handoffs/TEAM-XXXX/YYYY-MM-DD_HH-MM-SS_description.md`, where:

- **YYYY-MM-DD** is today's date
- **HH-MM-SS** is the current time in 24-hour format (e.g. `13:00` for 1:00 pm)
- **TEAM-XXXX** is the ticket number (replace with `general` if no ticket; team prefixes include GS1, GS2, PS, RD, MAINT, etc.)
- **description** is a brief kebab-case description

**Examples:**
- With ticket: `2025-01-08_13-55-22_GS1-2166_create-context-compaction.md`
- Without ticket: `2025-01-08_13-55-22_create-context-compaction.md`

### 2. Write the Handoff Document

Using the filepath and metadata from step 1, create the document with the following template:

```markdown
---
date: [Current date and time with timezone in ISO format]
researcher: [Researcher name from thoughts status]
git_commit: [Current commit hash]
branch: [Current branch name]
repository: [Repository name]
topic: '[Feature/Task Name] Implementation Strategy'
tags: [implementation, strategy, relevant-component-names]
status: complete
last_updated: [Current date in YYYY-MM-DD format]
last_updated_by: [Researcher name]
type: implementation_strategy
---

# Handoff: {ticket number} {very concise description}

## Task(s)

{description of the task(s) that you were working on, along with the status of each (completed, work in progress, planned/discussed). If you are working on an implementation plan, make sure to call out which phase you are on. Make sure to reference the plan document and/or research document(s) you are working from that were provided to you at the beginning of the session, if applicable.}

## Critical References

{List any critical specification documents, architectural decisions, or design docs that must be followed. Include only 2-3 most important file paths. Leave blank if none.}

## Recent changes

{describe recent changes made to the codebase that you made in line:file syntax}

## Learnings

{describe important things that you learned - e.g. patterns, root causes of bugs, or other important pieces of information someone that is picking up your work after you should know. consider listing explicit file paths.}

## Artifacts

{ an exhaustive list of artifacts you produced or updated as filepaths and/or file:line references - e.g. paths to feature documents, implementation plans, etc that should be read in order to resume your work.}

## Action Items & Next Steps

{ a list of action items and next steps for the next agent to accomplish based on your tasks and their statuses}

## Other Notes

{ other notes, references, or useful information - e.g. where relevant sections of the codebase are, where relevant documents are, or other important things you learned that you want to pass on but that don't fall into the above categories}
```

---

### 3. Approve and Sync

Save the document.

Once this is completed, you should respond to the user with the template between <template_response></template_response> XML tags. do NOT include the tags in your response.

<template_response>
Handoff created and synced! You can resume from this handoff in a new session with the following command:

```bash
/resume-handoff-doc path/to/handoff.md
```

</template_response>

for example (between <example_response></example_response> XML tags - do NOT include these tags in your actual response to the user)

<example_response>
Handoff created and synced! You can resume from this handoff in a new session with the following command:

```bash
/resume-handoff-doc thoughts/shared/handoffs/GS1-2166/2025-01-08_13-44-55_GS1-2166_create-context-compaction.md
```

</example_response>

---

## Additional Notes & Instructions

- **more information, not less**. This is a guideline that defines the minimum of what a handoff should be. Always feel free to include more information if necessary.
- **be thorough and precise**. include both top-level objectives, and lower-level details as necessary.
- **avoid excessive code snippets**. While a brief snippet to describe some key change is important, avoid large code blocks or diffs; do not include one unless it's necessary (e.g. pertains to an error you're debugging). Prefer using `/path/to/file.ext:line` references that an agent can follow later when it's ready, e.g. `packages/dashboard/src/app/dashboard/page.tsx:12-24`